/**
 * Retell's conversation-flow / retell-llm (multi-prompt & single-prompt)
 * payload shapes the compiler emits. These are OUR OWN internally-consistent
 * modeling of the documented Retell resources (VERIFY-8, docs/VERIFY.md):
 * confirmed via indexed search that a Conversation Flow accepts `nodes`/
 * `edges` and supports node types including `ConversationNode`,
 * `FunctionNode`, `TransferCallNode`, `ExtractDynamicVariablesNode`, and a
 * "Global Node" setting reachable from anywhere in the flow — but the exact
 * wire-level field names for each node/edge property were NOT independently
 * confirmed (docs.retellai.com is egress-blocked in this environment). Every
 * field below is therefore provisional; T4 (provisioning saga, first real
 * publish against a live Retell sandbox) must confirm field names against
 * that sandbox and adjust this file + its golden-file snapshots before any
 * template goes live — tracked as VERIFY-8.
 *
 * `model` is intentionally left OFF every request body here: it lives on
 * the `agent_configs`/`agent_templates` row, not the canonical `AgentTemplate`
 * content `compileTemplate` receives (BACKEND_SPEC §1.3) — `agents.ts`
 * attaches it from `CreateOrUpdateAgentInput.model` immediately before the
 * REST call, keeping this compiler pure/structural and independently
 * snapshot-testable without a model string as an input.
 */

import type { CompileTarget } from "@heyloo/canonical-types";

// ---------------------------------------------------------------------------
// Shared: a Retell "custom function" tool definition, wired to our
// `/voice/tools` webhook (API_AND_FLOWS.md A.1 "Tool-call webhook").
// ---------------------------------------------------------------------------

export interface RetellFunctionTool {
  type: "custom";
  name: string;
  description: string;
  url: string;
  parameters: object; // JSON-Schema, as authored in the canonical CanonicalTool
}

// ---------------------------------------------------------------------------
// Conversation Flow target
// ---------------------------------------------------------------------------

export interface RetellFlowEdge {
  id: string;
  destination_node_id: string;
  transition_condition: { type: "prompt"; prompt: string };
}

export interface RetellConversationNode {
  id: string;
  type: "conversation";
  name: string;
  instruction: { type: "prompt"; text: string };
  edges: RetellFlowEdge[];
  tool_ids: string[];
  /** Reachable from ANY node in the flow — Retell's global-node interrupt mechanism (SYSTEM_DESIGN §4.1). */
  global_node?: true;
}

export interface RetellEndNode {
  id: string;
  type: "end";
  name: string;
}

export type RetellConversationFlowNode = RetellConversationNode | RetellEndNode;

export interface RetellConversationFlowRequest {
  /** Shared instructions injected before every node's own instruction — lowered from `AgentTemplate.system_prompt`. */
  global_prompt?: string;
  start_node_id: string;
  nodes: RetellConversationFlowNode[];
  tools: RetellFunctionTool[];
  model?: string;
}

// ---------------------------------------------------------------------------
// Multi-prompt (Retell LLM "states") target
// ---------------------------------------------------------------------------

export interface RetellMultiPromptStateEdge {
  destination_state_name: string;
  description: string;
}

export interface RetellMultiPromptState {
  name: string;
  state_prompt: string;
  edges: RetellMultiPromptStateEdge[];
  tools: RetellFunctionTool[];
}

export interface RetellMultiPromptRequest {
  general_prompt: string;
  starting_state: string;
  states: RetellMultiPromptState[];
  model?: string;
}

// ---------------------------------------------------------------------------
// Single-prompt (Retell LLM, no states) target
// ---------------------------------------------------------------------------

export interface RetellSinglePromptRequest {
  general_prompt: string;
  general_tools: RetellFunctionTool[];
  model?: string;
}

// ---------------------------------------------------------------------------
// Compiler output — internal to this package (agents.ts consumes it to
// decide which REST resource to create: /create-conversation-flow for
// `conversation_flow`, /create-retell-llm for `multi_prompt`/`single_prompt`,
// both of which back a `response_engine` on the agent, API_AND_FLOWS.md A.1).
// ---------------------------------------------------------------------------

export type RetellFlowRequest =
  | { kind: "conversation_flow"; body: RetellConversationFlowRequest }
  | { kind: "multi_prompt"; body: RetellMultiPromptRequest }
  | { kind: "single_prompt"; body: RetellSinglePromptRequest };

export interface CompiledAgentPayload {
  compileTarget: CompileTarget;
  /** True only when the disclosure-line publish gate passed. Never publish/create-agent when false. */
  disclosureVerified: boolean;
  flowRequest: RetellFlowRequest;
}
