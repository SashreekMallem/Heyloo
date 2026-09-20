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
  /**
   * RETELL-VERIFY (GAP_REGISTER §1.4): confirmed via `retell-sdk`'s
   * `ConversationFlowCreateParams.CustomTool` that `speak_during_execution`/
   * `speak_after_execution` live on the TOOL definition itself (this
   * object), NOT on `FunctionNode` (which only re-exposes
   * `speak_during_execution` as a per-node override, no
   * `speak_after_execution` field at all — contrary to what the gap
   * register's own fix text assumed; see conversation-flow.ts's header
   * comment for the full correction). Set on any tool this compiler
   * function-locks to a single-tool state (task item 2) so the model
   * reliably reacts to/speaks the tool's result once it returns.
   */
  speak_during_execution?: boolean;
  speak_after_execution?: boolean;
}

/** A Retell "native" transfer-call tool — used in place of `RetellFunctionTool` wherever a canonical `transfer_call` tool is declared (GAP_REGISTER §1.4 item 4: "native wiring, not a custom webhook"). Shared shape across `general_tools`/state `tools` (multi_prompt, single_prompt) — RETELL-VERIFY, confirmed via `retell-sdk`'s `LlmCreateParams.TransferCallTool`. */
export interface RetellTransferCallTool {
  type: "transfer_call";
  name: string;
  description?: string;
  transfer_destination: RetellTransferDestination;
  transfer_option: RetellTransferOption;
}

export type RetellTransferDestination =
  | { type: "predefined"; number: string; extension?: string }
  | { type: "inferred"; prompt: string };

/**
 * Only `warm_transfer` is compiled by this package (SYSTEM_DESIGN §4.5:
 * "warm transfers always carry a context summary"). `agentic_warm_transfer`
 * is deliberately omitted from this union — RETELL-VERIFY (confirmed via
 * `sdk-contract.test.ts` against the real SDK types): it REQUIRES a nested
 * `agentic_transfer_config` object this compiler never constructs, so
 * including the bare variant here would make this type unsound (assignable
 * to `RetellTransferOption` but NOT to the real SDK's
 * `TransferOptionAgenticWarmTransfer`) for no benefit — nothing in this
 * package ever emits it.
 */
export type RetellTransferOption = { type: "cold_transfer" } | { type: "warm_transfer" };

export type RetellStateTool = RetellFunctionTool | RetellTransferCallTool;

// ---------------------------------------------------------------------------
// Conversation Flow target
// ---------------------------------------------------------------------------

/** A single equation, per `EquationCondition.Equation` (RETELL-VERIFY, identical shape on every node's edge type). */
export interface RetellEquation {
  left: string;
  operator:
    | "=="
    | "!="
    | ">"
    | ">="
    | "<"
    | "<="
    | "contains"
    | "not_contains"
    | "exists"
    | "not_exist";
  right?: string;
}

export type RetellTransitionCondition =
  | { type: "prompt"; prompt: string }
  | { type: "equation"; operator: "||" | "&&"; equations: RetellEquation[] };

export interface RetellFlowEdge {
  id: string;
  destination_node_id: string;
  transition_condition: RetellTransitionCondition;
}

/** `condition` is REQUIRED (non-empty) — confirmed via retell-sdk's `GlobalNodeSetting` (VERIFY-8, resolved); shared identically across every node type this compiler emits. */
export interface RetellGlobalNodeSetting {
  condition: string;
}

export interface RetellConversationNode {
  id: string;
  type: "conversation";
  name: string;
  instruction: { type: "prompt"; text: string };
  edges: RetellFlowEdge[];
  global_node_setting?: RetellGlobalNodeSetting;
}

/**
 * RETELL-VERIFY (GAP_REGISTER §1.4 item 4, confirmed via retell-sdk's
 * `ConversationFlowCreateParams.TransferCallNode`): the native transfer
 * mechanism — replaces the previous custom-webhook `transfer_call` tool
 * entirely for the `conversation_flow` target (never appears in the flow's
 * top-level `tools[]`). `edge` is singular and REQUIRED on the wire (not an
 * array) — it is the "transfer failed" fallback path only; a successful
 * transfer bridges the call away from this flow with no further routing
 * needed here.
 */
export interface RetellTransferCallNode {
  id: string;
  type: "transfer_call";
  transfer_destination: RetellTransferDestination;
  transfer_option: RetellTransferOption;
  /** `destination_node_id` is OPTIONAL on the real SDK's `TransferCallNode.Edge` (RETELL-VERIFIED) — this compiler always sets it (CALL-4: the "transfer failed" fallback lands on this state's own end node). */
  edge: {
    id: string;
    destination_node_id?: string;
    transition_condition: RetellTransitionCondition;
  };
  name?: string;
  global_node_setting?: RetellGlobalNodeSetting;
}

/**
 * CALL-4 (docs/BUILD_NOTES.md): RETELL-VERIFIED field-for-field against the
 * real retell-sdk TypeScript source
 * (`node_modules/retell-sdk/src/resources/conversation-flow.ts`,
 * `ConversationFlowCreateParams.SubagentNode`) — the node type built for
 * "dialogue with tool calling" (`tool_ids`, same `instruction`/`edges`/
 * `global_node_setting` shape as `RetellConversationNode`). Mirrors
 * `supabase/functions/_shared/compiler/template-compiler.ts`'s CALL-2 fix:
 * a plain `RetellConversationNode`'s LLM can never invoke a tool at all
 * (Retell's own docs: "Conversation nodes do not use tools / functions"),
 * so ANY state with 1+ tools — not only the single-tool case
 * `RetellFunctionNode` hard-locks to — must compile to this node type
 * instead, or it structurally cannot call anything its `allowed_tools`
 * promises. Previously this package only had `RetellFunctionNode` (a
 * single-tool hard lock) and fell back to a plain `RetellConversationNode`
 * for 0-or-2+-tool states — the 2+-tool case was exactly this same live
 * bug, just never caught here since this package isn't wired to a live
 * Retell account (header comment, T4/T3).
 */
export interface RetellSubagentNode {
  id: string;
  type: "subagent";
  name?: string;
  instruction: { type: "prompt"; text: string };
  edges?: RetellFlowEdge[];
  /** The flow-level `tools[].name` values (== `tool_id`) this node's LLM may call. RETELL-VERIFIED: `tool_ids?: Array<string> | null` on the real SDK's `SubagentNode`. */
  tool_ids?: string[];
  global_node_setting?: RetellGlobalNodeSetting;
}

/**
 * CALL-2/CALL-4 (docs/BUILD_NOTES.md): RETELL-VERIFIED field-for-field
 * against the real retell-sdk TypeScript source
 * (`ConversationFlowCreateParams.EndNode`) — the only way to end a call
 * from within a conversation flow; a node with no outgoing edge is a dead
 * end, not an implicit hangup. `global_node_setting` makes it reachable
 * from anywhere in the flow (CALL-4's generic wrap-up node), the same
 * mechanism every other node type here shares.
 */
export interface RetellEndNode {
  id: string;
  type: "end";
  name?: string;
  speak_during_execution?: boolean;
  instruction?: { type: "prompt"; text: string };
  global_node_setting?: RetellGlobalNodeSetting;
}

export type RetellConversationFlowNode =
  | RetellConversationNode
  | RetellSubagentNode
  | RetellTransferCallNode
  | RetellEndNode;

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
  tools: RetellStateTool[];
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
  general_tools: RetellStateTool[];
  model?: string;
}

// ---------------------------------------------------------------------------
// Post-call analysis data (GAP_REGISTER §1.1) — an AGENT-level field
// (RETELL-VERIFY: confirmed via retell-sdk's `AgentResponse.
// post_call_analysis_data`, NOT a field on either flow-resource request
// body), so it is not part of `RetellFlowRequest` above; `agents.ts` reads
// `CompiledAgentPayload.postCallAnalysisData` and attaches it to the
// create/update-agent request body directly.
// ---------------------------------------------------------------------------

interface RetellAnalysisFieldBase {
  name: string;
  description: string;
  required?: boolean;
  conditional_prompt?: string;
}

export type RetellPostCallAnalysisField =
  | (RetellAnalysisFieldBase & { type: "string"; examples?: string[] })
  | (RetellAnalysisFieldBase & { type: "enum"; choices: string[] })
  | (RetellAnalysisFieldBase & { type: "boolean" })
  | (RetellAnalysisFieldBase & { type: "number" });

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
  /** GAP_REGISTER §1.1 — lowered from every state's `extraction[]`; attached to the agent body by `agents.ts`, never sent as part of `flowRequest`. */
  postCallAnalysisData: RetellPostCallAnalysisField[];
}
