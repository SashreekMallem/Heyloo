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
 *   compiled greeting"). The start state ALWAYS compiles to a plain
 *   `ConversationNode`, regardless of its `allowed_tools` count — never a
 *   `FunctionNode`/`TransferCallNode` (GAP_REGISTER §1.4 below): those node
 *   types' `instruction` field is either absent or only spoken
 *   conditionally ("only used when speak_during_execution is true" — not
 *   the guaranteed-spoken first turn G1/G2 requires), and the disclosure
 *   publish gate (`disclosure-gate.ts`) only inspects a `type: "conversation"`
 *   start node's `instruction.text`. No shipped template's first state is
 *   single-tool today (a greeting never gates on exactly one tool), so this
 *   is a safe, documented constraint rather than a live behavior change.
 * - Each remaining `AgentState` becomes one Retell node, its exact TYPE
 *   decided by `allowed_tools` (GAP_REGISTER §1.4 "no per-node tool
 *   locking"):
 *     - `allowed_tools: ["transfer_call"]` (the one reserved tool name
 *       `transferCallTool()` always uses, `packages/templates/src/shared/
 *       tools.ts`) compiles to a native `TransferCallNode` (GAP_REGISTER
 *       §1.4 item 4 — "not a custom webhook"). This tool is therefore
 *       NEVER emitted into the flow's top-level `tools[]` custom-function
 *       list at all.
 *     - any other SINGLE tool compiles to a `FunctionNode` — RETELL-VERIFY,
 *       confirmed via retell-sdk that `FunctionNode` (unlike
 *       `ConversationNode`) really does hard-lock the model to exactly one
 *       tool_id, with `wait_for_result: true` so the graph's own edges (not
 *       model recall) decide what happens once the tool returns.
 *     - zero tools, or 2+ tools, compiles to the previous plain
 *       `ConversationNode` (no structural per-node tool-scoping mechanism
 *       exists for that case — `allowed_tools` stays prose-only steering
 *       there, same limitation the prior version of this file documented).
 * - `Transition`s become edges on their `from` node's `edges` array — EXCEPT
 *   a `TransferCallNode`'s from-side, which has no `edges` array at all (a
 *   single required `edge`, the "transfer failed" fallback only); every
 *   shipped `transferCallTool()`-only state is `is_terminal: true` with no
 *   outgoing `transitions`, so this is a structural non-issue today, not a
 *   silently-dropped case.
 *   - A transition whose `on.tool_result` is set (GAP_REGISTER §1.5,
 *     "predicate-on-tool-result") compiles to an EQUATION-typed edge
 *     (`{type:"equation", operator:"&&", equations:[{left:variable,
 *     operator,right:value}]}`) instead of a free-text `{type:"prompt"}`
 *     edge — deterministic, not model-discretionary. RETELL-VERIFY: a
 *     dedicated Retell "Logic Split" node type was assumed by the audit,
 *     but `retell-sdk` confirms equation-typed edges are a property of
 *     EVERY node's own `edges` array (`ConversationNode`/`FunctionNode`/
 *     `BranchNode` all share the identical `Edge.EquationCondition` shape)
 *     — a separate `BranchNode` adds a redundant hop with no additional
 *     capability, so this compiler emits the equation edge directly on the
 *     origin node. Logged to `docs/BUILD_NOTES.md` (task A) as a documented
 *     correction to the gap register's assumed node shape, not a silent
 *     redesign (CLAUDE.md Rule 4).
 * - `global_intents` with `reachable_from: "any"` set their TARGET node's
 *   `global_node_setting: {condition}` (Retell's global-node interrupt
 *   mechanism, identical shape on every node type this compiler emits); a
 *   scoped `reachable_from` list instead adds an explicit edge from each
 *   listed state (skipped for a `TransferCallNode` source, same rationale
 *   as above), so the escape is structurally present either way — never
 *   model-discretionary (SYSTEM_DESIGN §4.1).
 */

import type { AgentState, AgentTemplate, Transition } from "@heyloo/canonical-types";
import type {
  RetellConversationFlowNode,
  RetellConversationFlowRequest,
  RetellConversationNode,
  RetellEquation,
  RetellFlowEdge,
  RetellFunctionNode,
  RetellFunctionTool,
  RetellTransferCallNode,
  RetellTransitionCondition,
} from "./types.js";

/** The one reserved tool name `transferCallTool()` always uses (`packages/templates/src/shared/tools.ts`). */
const TRANSFER_CALL_TOOL_NAME = "transfer_call";

function toolResultTransitionCondition(transition: Transition): RetellTransitionCondition {
  const toolResult = transition.on.tool_result;
  if (!toolResult) {
    return { type: "prompt", prompt: transition.on.intent ?? transition.on.predicate ?? "" };
  }
  const equation: RetellEquation = {
    left: toolResult.variable,
    operator: toolResult.operator,
    ...(toolResult.value !== undefined ? { right: toolResult.value } : {}),
  };
  return { type: "equation", operator: "&&", equations: [equation] };
}

function buildEdge(transition: Transition, index: number): RetellFlowEdge {
  return {
    id: `edge_${transition.from}_${transition.to}_${index}`,
    destination_node_id: transition.to,
    transition_condition: toolResultTransitionCondition(transition),
  };
}

function buildNode(state: AgentState, isStart: boolean): RetellConversationFlowNode {
  const singleTool = state.allowed_tools.length === 1 ? state.allowed_tools[0] : undefined;

  if (!isStart && singleTool === TRANSFER_CALL_TOOL_NAME) {
    const transferNode: RetellTransferCallNode = {
      id: state.id,
      type: "transfer_call",
      name: state.name,
      transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
      // Warm transfer — SYSTEM_DESIGN §4.5: "warm transfers always carry a context summary".
      transfer_option: { type: "warm_transfer" },
      edge: {
        id: `${state.id}_transfer_failed`,
        transition_condition: { type: "prompt", prompt: "Transfer failed" },
      },
    };
    return transferNode;
  }

  if (!isStart && singleTool !== undefined) {
    const functionNode: RetellFunctionNode = {
      id: state.id,
      type: "function",
      name: state.name,
      tool_id: singleTool,
      tool_type: "local",
      wait_for_result: true,
      instruction: { type: "prompt", text: state.prompt_fragment },
      speak_during_execution: true,
      edges: [],
    };
    return functionNode;
  }

  const conversationNode: RetellConversationNode = {
    id: state.id,
    type: "conversation",
    name: state.name,
    instruction: { type: "prompt", text: state.prompt_fragment },
    edges: [],
  };
  return conversationNode;
}

export function compileConversationFlow(
  template: AgentTemplate,
  toolWebhookUrl: string,
): RetellConversationFlowRequest {
  // Tools locked to exactly one FunctionNode get speak_during_execution/
  // speak_after_execution so the model reliably reacts once the tool
  // returns (RETELL-VERIFY: these flags live on the tool definition, not
  // the node — types.ts header comment). transfer_call is excluded
  // entirely: it compiles to a native TransferCallNode, never a
  // custom-function tool (GAP_REGISTER §1.4 item 4).
  const startState = template.states[0];
  const functionLockedToolNames = new Set(
    template.states
      .filter(
        (s) =>
          s.id !== startState?.id &&
          s.allowed_tools.length === 1 &&
          s.allowed_tools[0] !== TRANSFER_CALL_TOOL_NAME,
      )
      .map((s) => s.allowed_tools[0] as string),
  );

  const tools: RetellFunctionTool[] = template.tools
    .filter((tool) => tool.name !== TRANSFER_CALL_TOOL_NAME)
    .map((tool) => ({
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
      ...(functionLockedToolNames.has(tool.name)
        ? { speak_during_execution: true, speak_after_execution: true }
        : {}),
    }));

  const nodesById = new Map<string, RetellConversationFlowNode>();
  for (const state of template.states) {
    nodesById.set(state.id, buildNode(state, state.id === startState?.id));
  }

  for (const [index, transition] of template.transitions.entries()) {
    const fromNode = nodesById.get(transition.from);
    if (!fromNode) continue; // guarded upstream by zAgentTemplate's structural validation
    if (fromNode.type === "transfer_call" || fromNode.type === "end") continue; // no outgoing-edges array on these node types
    fromNode.edges ??= [];
    fromNode.edges.push(buildEdge(transition, index));
  }

  applyGlobalIntents(nodesById, template);

  const startNodeId = startState?.id ?? "";
  if (startState) {
    const startNode = nodesById.get(startState.id);
    if (startNode && startNode.type === "conversation") {
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
  nodesById: Map<string, RetellConversationFlowNode>,
  template: AgentTemplate,
): void {
  for (const globalIntent of template.global_intents) {
    const targetNode = nodesById.get(globalIntent.target_state);
    if (!targetNode || targetNode.type === "end") continue; // guarded upstream by zAgentTemplate's structural validation

    if (globalIntent.reachable_from === "any") {
      targetNode.global_node_setting = { condition: globalIntent.description };
      continue;
    }

    for (const fromStateId of globalIntent.reachable_from) {
      const fromNode = nodesById.get(fromStateId);
      if (!fromNode) continue;
      if (fromNode.type === "transfer_call" || fromNode.type === "end") continue;
      fromNode.edges ??= [];
      fromNode.edges.push({
        id: `global_${globalIntent.name}_${fromStateId}_${globalIntent.target_state}`,
        destination_node_id: globalIntent.target_state,
        transition_condition: { type: "prompt", prompt: globalIntent.description },
      });
    }
  }
}
