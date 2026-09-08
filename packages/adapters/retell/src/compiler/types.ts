/**
 * Retell's conversation-flow / retell-llm (multi-prompt & single-prompt)
 * payload shapes the compiler emits.
 *
 * VERIFY-8 (RESOLVED, RETELL-VERIFY): confirmed field-for-field against the
 * official `retell-typescript-sdk`'s `src/resources/{conversation-flow,
 * llm}.ts`:
 * - `ConversationNode` really does have `id`/`type`/`name`/`edges`/
 *   `instruction: {type:"prompt", text}` — all confirmed exactly as
 *   modeled here. `Edge = {id, destination_node_id, transition_condition:
 *   {type:"prompt", prompt}}` also confirmed exactly.
 * - `global_node?: true` was WRONG — the real field is
 *   `global_node_setting: {condition: string, ...}` (an object, `condition`
 *   REQUIRED — "cannot be empty"), not a boolean. Fixed below.
 * - `tool_ids` is NOT a field on the plain `ConversationNode` at all —
 *   confirmed absent from every property Retell documents on it. (It DOES
 *   exist, but only on `SubagentNode`, a different node type this compiler
 *   doesn't emit.) There is no per-node tool restriction mechanism for a
 *   flat conversation-flow graph: every node effectively has access to
 *   every tool declared in the flow's top-level `tools[]`, and per-state
 *   steering is soft/prompt-only (`instruction.text` telling the model
 *   which tools make sense here) rather than a hard allow-list. Removed
 *   `tool_ids` from `RetellConversationNode` accordingly — this was a
 *   SYSTEM_DESIGN §4.1-conflicting gap (that section wants "tool-backed
 *   nodes only... model cannot invent"), logged to BUILD_NOTES.md
 *   (RETELL-VERIFY) as a genuine architecture gap rather than silently
 *   redesigned here (CLAUDE.md Rule 4) — a real hard per-node restriction
 *   would need `SubagentNode`, a materially different graph shape.
 * - Multi-prompt (Retell LLM) `State = {name, state_prompt?, edges:
 *   [{destination_state_name, description}], tools: [...]}` — CONFIRMED
 *   exactly, including that `tools` on a state carries FULL tool
 *   definitions (not ids), unlike conversation-flow.
 * - The `custom` function tool shape (`{name, type:"custom", url,
 *   description?, parameters?}`) is confirmed exactly, for both
 *   conversation-flow's top-level `tools[]` and Retell LLM's per-state
 *   `tools[]`/`general_tools[]`. Its `parameters` object is confirmed
 *   `{type:"object", properties, required?}` with `properties` REQUIRED
 *   (not optional as this codebase's broader canonical `JsonSchemaObject`
 *   allows for template-authoring purposes) — `RetellFunctionTool.parameters`
 *   below defaults an omitted `properties` to `{}` when lowering a
 *   canonical tool, so the wire shape is always valid even for a
 *   zero-argument tool.
 * - `start_node_id`/`start_node_id`... and crucially `start_speaker: "user"
 *   | "agent"` is REQUIRED on `ConversationFlowCreateParams` (unlike Retell
 *   LLM, where it's optional) — a gap the type-level SDK contract test
 *   (`sdk-contract.test.ts`) caught. Every template this codebase compiles
 *   opens with the agent's own greeting/disclosure line, so this compiler
 *   always emits `start_speaker: "agent"`.
 *
 * `model`/`model_choice` is intentionally left OFF every request body here:
 * it lives on the `agent_configs`/`agent_templates` row, not the canonical
 * `AgentTemplate` content `compileTemplate` receives (BACKEND_SPEC §1.3) —
 * `agents.ts` attaches it from `CreateOrUpdateAgentInput.model` immediately
 * before the REST call (as a flat `model` string for multi_prompt/
 * single_prompt, or nested `model_choice: {model, type:"cascading"}` for
 * conversation_flow — confirmed these are NOT wire-compatible, see
 * agents.ts), keeping this compiler pure/structural and independently
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
  /**
   * JSON-Schema, lowered from the canonical `CanonicalTool.parameters`
   * (`properties` defaulted to `{}` when the canonical tool omitted it —
   * confirmed via retell-typescript-sdk that the SDK's own `properties`
   * field is REQUIRED whenever `parameters` is present at all).
   */
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
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
  /**
   * Reachable from ANY node in the flow — Retell's global-node interrupt
   * mechanism (SYSTEM_DESIGN §4.1). `condition` is REQUIRED (non-empty) —
   * confirmed via retell-typescript-sdk's `GlobalNodeSetting` (VERIFY-8,
   * resolved); this replaces a previously-assumed bare `global_node: true`
   * boolean, which is not a real field.
   */
  global_node_setting?: { condition: string };
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
  /**
   * REQUIRED on `ConversationFlowCreateParams` (confirmed via
   * retell-typescript-sdk — unlike Retell LLM, where it's optional).
   * Always `"agent"`: every template this compiler emits opens with the
   * agent's own greeting/disclosure line (G1/G2), never a user-speaks-first
   * flow.
   */
  start_speaker: "agent";
  nodes: RetellConversationFlowNode[];
  tools: RetellFunctionTool[];
  /**
   * NOT set by this compiler (see this file's header comment) — `agents.ts`
   * attaches the REQUIRED `model_choice: {model, type:"cascading"}` object
   * immediately before the REST call. Confirmed via retell-typescript-sdk
   * that conversation-flow's model field is this nested object, NOT a flat
   * `model` string (unlike Retell LLM's `RetellMultiPromptRequest`/
   * `RetellSinglePromptRequest.model` below) — VERIFY-8, resolved.
   */
  model_choice?: { model: string; type: "cascading"; high_priority?: boolean };
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
