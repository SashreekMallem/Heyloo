/**
 * Lowers a canonical `AgentTemplate` (compile_target `conversation_flow`)
 * into a Retell Conversation Flow request body (SYSTEM_DESIGN §4.1: auto,
 * dental, motel, restaurant, vet — "hard slot-filling; typed Extract-DV
 * nodes; model cannot invent prices/menu items/rates — tool-backed nodes
 * only").
 *
 * CALL-4 (docs/BUILD_NOTES.md): this file is kept in PARITY with the live
 * `supabase/functions/_shared/compiler/template-compiler.ts` (same node-type
 * decisions, same is_terminal/wrap-up/transfer-call design — see
 * `parity.test.ts` alongside this file, which compiles a shared fixture
 * through both and asserts matching node types/edges) — it previously
 * diverged (subagent nodes, is_terminal end-nodes, and the honest
 * transfer-call fallback were all live-verified and shipped in the Deno
 * compiler under CALL-2/CALL-4 but never mirrored here, docs/BUILD_NOTES.md
 * CALL-2 gap #7). Node-type decisions below now match that file's:
 * - DISCLOSE-1 (docs/BUILD_NOTES.md): the flow's entry node is a static
 *   `__opening` conversation node (`instruction.type: "static_text"`) that
 *   speaks `disclosure_line` + `{{caller_greeting}}` + a short question
 *   verbatim (`opening.ts#buildOpeningLine`), copies the first declared
 *   state's edges and falls through `else_edge` to it. The FIRST declared
 *   state (`template.states[0]`) is told its greeting was already spoken
 *   (G1/G2: the disclosure is no longer a prompt the model can paraphrase).
 *   The start state ALWAYS
 *   compiles to a plain `ConversationNode`, regardless of its
 *   `allowed_tools` count — never a `SubagentNode`/`TransferCallNode`: the
 *   disclosure publish gate (`disclosure-gate.ts`) only inspects a
 *   `type: "conversation"`/`"subagent"` start node's `instruction.text`,
 *   and no shipped template's first state needs a tool anyway.
 * - `allowed_tools: ["transfer_call"]` (the one reserved tool name
 *   `transferCallTool()` always uses) compiles to TWO nodes now (PUBLISH-1,
 *   docs/BUILD_NOTES.md): a router node (kept at the state's own id) and a
 *   dedicated `${state.id}__transfer` native `TransferCallNode` whose
 *   destination is the literal `{{transfer_number}}` TOKEN (RETELL-
 *   VERIFIED, docs.retellai.com/api-references/create-conversation-flow +
 *   .../build/dynamic-variables, 2026-09-21 — a predefined destination
 *   accepts a dynamic-variable placeholder) — resolved by Retell PER CALL
 *   from the live `transfer_number` dynamic variable (G6, tenant-config-
 *   only: the only source that ever populates it is `agent_configs.
 *   transfer_number`), never baked in as a literal at compile time (CALL-4's
 *   original design — the problem: a tenant's later transfer-number change
 *   then never took effect without a republish). The router's own edge onto
 *   the transfer node — and its own take_message-based honest fallback for
 *   whenever the live value turns out empty — is a genuine RUNTIME decision,
 *   evaluated per call. `transfer_call` is NEVER emitted into the flow's
 *   top-level `tools[]` custom-function list at all (never a real HTTP
 *   `/voice-tools` call).
 * - Any other state with 1+ tools compiles to a `SubagentNode` — RETELL
 *   VERIFIED (docs.retellai.com/build/conversation-flow/overview: "Conversation
 *   nodes do not use tools / functions"; the real retell-sdk source
 *   confirms `SubagentNode.tool_ids`) — CALL-4 replaces the previous
 *   `FunctionNode`-for-single-tool / plain-`ConversationNode`-for-2+-tools
 *   split with this single, live-proven rule (matching the Deno compiler
 *   exactly): a `ConversationNode` can NEVER call a tool, full stop, so any
 *   tool-bearing state needs `SubagentNode`, not just the single-tool case.
 * - Every `is_terminal` state gets its own `end` node plus an edge onto it
 *   (CALL-2's fix, mirrored here for the first time) — a transfer_call
 *   node's own required `edge` (the "transfer failed" fallback) targets
 *   that SAME end node.
 * - A generic wrap-up node/end-node pair (CALL-4) is reachable from
 *   anywhere via `global_node_setting` ("Is there anything else I can help
 *   with?" -> no -> end, or -> yes -> back to the start node) — closes the
 *   gap where a state that answers an FAQ inline (never itself
 *   `is_terminal`, since it's also the booking entry point) has no path to
 *   end the call.
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
 *     EVERY node's own `edges` array (`ConversationNode`/`SubagentNode`/
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
 *   listed state (skipped for a `TransferCallNode`/`EndNode` source, same
 *   rationale as above), so the escape is structurally present either way —
 *   never model-discretionary (SYSTEM_DESIGN §4.1).
 *
 * OPS-5 UPDATE (docs/BUILD_NOTES.md): the gap this paragraph used to
 * describe — the canonical `VoiceProvider.compileTemplate(template,
 * target)` interface (`@heyloo/canonical-types`) having no tenant-context
 * parameter, so `RetellProvider.compileTemplate`/`compileRetellTemplate`
 * (this package's PUBLIC entry points) couldn't pass a `transferNumber`
 * through — is now closed: `CompileTemplateOptions` (canonical-types) adds
 * an optional third `options` param, threaded through
 * `RetellProvider.compileTemplate` -> `compileTemplateArtifact` ->
 * `compileRetellTemplate` -> here, unchanged in shape from the
 * `transferNumber` option this function already accepted. Every existing
 * 2-3-arg public call keeps compiling exactly as it did before (the
 * options object is optional at every layer) — this only makes it
 * POSSIBLE for a caller with tenant context to pass one through; nothing
 * is forced to yet. This package still isn't wired into any live deploy
 * path (Deno/Node boundary, file-top-of-package README) — its only real
 * consumer today is `packages/templates`' red-team suite
 * (`compiler-gate.test.ts`,
 * `run-simulation.ts`), never live traffic.
 */

import type { AgentState, AgentTemplate, Transition } from "@heyloo/canonical-types";
import { withCustomAnswersParameter } from "./custom-answers.js";
import {
  buildOpeningLine,
  COMPILER_DEFAULT_DYNAMIC_VARIABLES,
  NO_TRANSFER_FALLBACK_INSTRUCTION,
  OPENING_INTERRUPTION_SENSITIVITY,
  openingAlreadySpokenInstruction,
  TRANSFER_ANNOUNCEMENT_INSTRUCTION,
} from "./opening.js";
import { OWNER_INFO_INSTRUCTIONS } from "./owner-info.js";
import type {
  RetellConversationFlowNode,
  RetellConversationFlowRequest,
  RetellConversationNode,
  RetellEndNode,
  RetellEquation,
  RetellFlowEdge,
  RetellFunctionTool,
  RetellSubagentNode,
  RetellTransferCallNode,
  RetellTransitionCondition,
} from "./types.js";

/** The one reserved tool name `transferCallTool()` always uses (`packages/templates/src/shared/tools.ts`) — never a real HTTP `/voice-tools` call, a native Retell transfer-call node instead. */
const TRANSFER_CALL_TOOL_NAME = "transfer_call";
/** The shared take-message tool every vertical declares (`packages/templates/src/shared/tools.ts#takeMessageTool`) — granted, compiler-side only, to a transfer-only state's router node, always (PUBLISH-1). */
const TAKE_MESSAGE_TOOL_NAME = "take_message";

/** PUBLISH-1 (docs/BUILD_NOTES.md, mirrors `_shared/compiler/template-compiler.ts` exactly):
 * the literal string always baked into a compiled `TransferCallNode.
 * transfer_destination.number` — Retell substitutes it per call from the
 * live `transfer_number` dynamic variable (RETELL-VERIFIED,
 * docs.retellai.com/api-references/create-conversation-flow +
 * docs.retellai.com/build/dynamic-variables, 2026-09-21: "The number to
 * transfer to in E.164 format or a dynamic variable like
 * `{{transfer_number}}`."). Never a real number. */
const TRANSFER_NUMBER_TOKEN = "{{transfer_number}}";

/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md): what the transfer-only state's ROUTER
 * node says. The live Deno compiler emits that router as a silent Retell
 * logic-split (`type: "branch"`) node; this package cannot yet (its
 * `sdk-contract.test.ts`, outside this compiler directory, narrows every
 * non-conversation/subagent/transfer node to `EndNode` and would stop
 * type-checking — see docs/BUILD_NOTES.md DISCLOSE-1), so it emits a
 * conversation node with the SAME deterministic equation edge / else edge
 * and an instruction that forbids any connection claim. `parity.test.ts`
 * pins exactly this one documented difference (node type only).
 */
const TRANSFER_ROUTER_INSTRUCTION =
  'Acknowledge the caller\'s request in a few words (for example "One moment."). Never say or ' +
  "imply that you are connecting or transferring them — the next step decides, from this " +
  "business's live transfer line, whether a real connection is possible, and a real transfer " +
  "announces itself.";

/** DISCLOSE-1: mirrors the Deno compiler's deterministic "a live number is available" test — an E.164 number always contains "+"; a blank or unset `{{transfer_number}}` never does. RETELL-VERIFIED equation syntax (docs.retellai.com/build/conversation-flow/transition-condition, 2026-09-29). */
const LIVE_TRANSFER_NUMBER_EQUATION: RetellEquation = {
  left: TRANSFER_NUMBER_TOKEN,
  operator: "contains",
  right: "+",
};

/** DISCLOSE-1: the static opening node's id — always the flow's `start_node_id` (mirrors template-compiler.ts). */
const OPENING_NODE_ID = "__opening";

/** CALL-4: the caller-supplied compile-time inputs this function accepts in addition to the template itself — see this file's own header comment for why `transferNumber` isn't threaded through the package's PUBLIC entry points yet. */
export interface CompileConversationFlowOptions {
  /**
   * PUBLISH-1 (docs/BUILD_NOTES.md): no longer read by this file — mirrors
   * `_shared/compiler/template-compiler.ts`'s identical change exactly.
   * Every transfer-only state now ALWAYS compiles the same way (the
   * `{{transfer_number}}` dynamic-variable token, decided at RUNTIME, see
   * `buildTransferOnlyNodes`), so this can never again change the compiled
   * output. Kept only so existing 3-arg call sites keep compiling.
   */
  transferNumber?: string | null;
}

function isTransferOnlyState(state: AgentState): boolean {
  return state.allowed_tools.length === 1 && state.allowed_tools[0] === TRANSFER_CALL_TOOL_NAME;
}

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

/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md; supersedes PUBLISH-1's speaking,
 * model-judged router — mirrors `_shared/compiler/template-compiler.ts`):
 * a transfer-only state compiles to a router at the state's own id (so
 * every existing incoming edge/global intent still resolves) that picks
 * deterministically, via an equation on `{{transfer_number}}`, between:
 *  - `${id}__transfer`: the native TransferCallNode (destination the
 *    literal `{{transfer_number}}` token, PUBLISH-1) — the ONLY node that
 *    tells the caller they're being connected, while it actually transfers;
 *  - `${id}__no_transfer`: the honest fallback — the state's own authored
 *    content plus `NO_TRANSFER_FALLBACK_INSTRUCTION` (never claim a
 *    connection, restate an emergency referral first, take a message).
 * A failed transfer also lands on the fallback. `knownToolNames` mirrors
 * that file's `toolsByName` guard.
 */
function buildTransferOnlyNodes(
  state: AgentState,
  knownToolNames: Set<string>,
): {
  nodes: RetellConversationFlowNode[];
  endEdgeOwner: RetellSubagentNode | RetellConversationNode;
} {
  const transferNodeId = `${state.id}__transfer`;
  const noTransferNodeId = `${state.id}__no_transfer`;

  const router: RetellConversationNode = {
    id: state.id,
    type: "conversation",
    name: state.name,
    instruction: { type: "prompt", text: TRANSFER_ROUTER_INSTRUCTION },
    edges: [
      {
        id: `edge_${state.id}_has_transfer`,
        destination_node_id: transferNodeId,
        transition_condition: {
          type: "equation",
          operator: "&&",
          equations: [LIVE_TRANSFER_NUMBER_EQUATION],
        },
      },
    ],
    else_edge: {
      id: `edge_${state.id}_no_transfer`,
      destination_node_id: noTransferNodeId,
      transition_condition: { type: "prompt", prompt: "Else" },
    },
  };

  const transferNode: RetellTransferCallNode = {
    id: transferNodeId,
    type: "transfer_call",
    name: `${state.name} — live transfer`,
    transfer_destination: { type: "predefined", number: TRANSFER_NUMBER_TOKEN },
    // Warm transfer — SYSTEM_DESIGN §4.5: "warm transfers always carry a context summary".
    transfer_option: { type: "warm_transfer" },
    speak_during_execution: true,
    instruction: { type: "prompt", text: TRANSFER_ANNOUNCEMENT_INSTRUCTION },
    edge: {
      id: `${state.id}_transfer_failed`,
      destination_node_id: noTransferNodeId,
      // PUBLISH-1 (docs/BUILD_NOTES.md, mirrors template-compiler.ts
      // exactly): RETELL-VERIFIED live 2026-09-21 — a TransferCallNode's
      // `edge.transition_condition` is NOT free text like every other
      // node's edges; its JSON schema requires `prompt` to be the LITERAL
      // string "Transfer failed", nothing else.
      transition_condition: { type: "prompt", prompt: "Transfer failed" },
    },
  };

  const toolIds = [TAKE_MESSAGE_TOOL_NAME].filter((name) => knownToolNames.has(name));
  // CALL-4 live-iteration fix (mirrors template-compiler.ts exactly): an
  // adversarial caller who keeps repeating the same transfer demand never
  // satisfies the generic "nothing further to discuss" end edge, so this
  // fallback gets an EXTRA edge to that same end node satisfied by the
  // AGENT's own turn instead.
  const fallbackDoneEdges: RetellFlowEdge[] = state.is_terminal
    ? [
        {
          id: `edge_${state.id}_fallback_done`,
          destination_node_id: `${state.id}__end`,
          transition_condition: {
            type: "prompt",
            prompt:
              "you have already clearly told the caller you can't connect them to anyone right " +
              "now (restating any emergency referral) and offered to take a message at least " +
              "once, or told them their message is already with the team — end here even if " +
              "the caller keeps repeating the same request",
          },
        },
      ]
    : [];
  // QA-HOT/FOLLOWUP-1: the state's OWN authored content is kept (e.g. vet's
  // emergency referral), followed by the no-transfer rules.
  const fallbackText = `${state.prompt_fragment}\n\n${NO_TRANSFER_FALLBACK_INSTRUCTION}`;
  const fallback: RetellSubagentNode | RetellConversationNode =
    toolIds.length > 0
      ? ({
          id: noTransferNodeId,
          type: "subagent",
          name: `${state.name} — no live transfer`,
          instruction: { type: "prompt", text: fallbackText },
          edges: fallbackDoneEdges,
          tool_ids: toolIds,
        } satisfies RetellSubagentNode)
      : ({
          id: noTransferNodeId,
          type: "conversation",
          name: `${state.name} — no live transfer`,
          instruction: { type: "prompt", text: fallbackText },
          edges: fallbackDoneEdges,
        } satisfies RetellConversationNode);

  return { nodes: [router, transferNode, fallback], endEdgeOwner: fallback };
}

/**
 * CALL-4: node-type decision now matches `template-compiler.ts` (the live
 * Deno compiler) exactly — see this file's header comment for the full
 * rationale.
 */
function buildNode(
  state: AgentState,
  isStart: boolean,
  knownToolNames: Set<string>,
): RetellConversationFlowNode {
  const requestedTools = state.allowed_tools ?? [];
  const toolIds = requestedTools.filter((name) => knownToolNames.has(name));

  if (!isStart && toolIds.length > 0) {
    const subagentNode: RetellSubagentNode = {
      id: state.id,
      type: "subagent",
      name: state.name,
      instruction: { type: "prompt", text: state.prompt_fragment },
      edges: [],
      tool_ids: toolIds,
    };
    return subagentNode;
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
  options: CompileConversationFlowOptions = {},
): RetellConversationFlowRequest {
  // PUBLISH-1: `options.transferNumber` no longer affects the compiled
  // output (see `CompileConversationFlowOptions`'s doc comment) —
  // referenced only so existing 3-arg call sites keep compiling under
  // `noUnusedParameters`.
  void options.transferNumber;
  const startState = template.states[0];
  const opening = buildOpeningLine(template.disclosure_line);

  // transfer_call is never emitted into the flow's top-level custom-function
  // tools list (native node instead, whichever branch above); every other
  // tool that ends up locked to a single-tool SubagentNode gets
  // speak_during_execution/speak_after_execution so the model reliably
  // reacts once the tool returns (RETELL-VERIFY: these flags live on the
  // tool definition, not the node — types.ts header comment).
  const singleLockedToolNames = new Set(
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
      parameters: withCustomAnswersParameter(tool.name, {
        type: "object",
        properties: tool.parameters.properties ?? {},
        ...(tool.parameters.required !== undefined ? { required: tool.parameters.required } : {}),
      }),
      ...(singleLockedToolNames.has(tool.name)
        ? { speak_during_execution: true, speak_after_execution: true }
        : {}),
    }));
  const knownToolNames = new Set(tools.map((t) => t.name));
  knownToolNames.add(TAKE_MESSAGE_TOOL_NAME); // always grantable to the no-transfer-number fallback if declared

  const nodesById = new Map<string, RetellConversationFlowNode>();
  // DISCLOSE-1: which node a state's is_terminal end-edge hangs off — the
  // state's own node, or a transfer-only state's no-transfer fallback
  // (mirrors template-compiler.ts's `endEdgeOwner`).
  const endEdgeOwner = new Map<string, RetellConversationFlowNode>();
  for (const state of template.states) {
    const isStart = state.id === startState?.id;
    // DISCLOSE-1: a transfer-only state (never the start state, see this
    // file's header) compiles to THREE nodes now — see `buildTransferOnlyNodes`.
    if (!isStart && isTransferOnlyState(state)) {
      const built = buildTransferOnlyNodes(state, knownToolNames);
      for (const node of built.nodes) {
        nodesById.set(node.id, node);
      }
      endEdgeOwner.set(state.id, built.endEdgeOwner);
      continue;
    }
    const node = buildNode(state, isStart, knownToolNames);
    nodesById.set(state.id, node);
    endEdgeOwner.set(state.id, node);
  }

  for (const [index, transition] of template.transitions.entries()) {
    const fromNode = nodesById.get(transition.from);
    if (!fromNode) continue; // guarded upstream by zAgentTemplate's structural validation
    if (fromNode.type === "transfer_call" || fromNode.type === "end") continue; // no outgoing-edges array on these node types
    fromNode.edges ??= [];
    fromNode.edges.push(buildEdge(transition, index));
  }

  applyGlobalIntents(nodesById, template);

  const startStateId = startState?.id ?? "";
  const startNode = startState ? nodesById.get(startState.id) : undefined;
  // DISCLOSE-1 (mirrors template-compiler.ts): the disclosure is spoken
  // verbatim by the static opening node now, never prepended to a prompt
  // the model could paraphrase; the start state is told it was already said.
  if (startNode && startNode.type === "conversation") {
    startNode.instruction = {
      type: "prompt",
      text: `${openingAlreadySpokenInstruction(opening)}\n\n${startNode.instruction.text}`,
    };
  }

  // CALL-2/CALL-4 (mirrors template-compiler.ts): every `is_terminal` state
  // gets its own `end` node plus one edge onto it, so the flow always has
  // somewhere to go once that state's business is done. A transfer_call
  // node's own `edge` (built above) already targets this exact id — it has
  // no `.edges` array to push onto, so it's skipped here, not double-wired.
  const endNodes: RetellEndNode[] = [];
  for (const state of template.states) {
    if (!state.is_terminal) continue;
    const fromNode = endEdgeOwner.get(state.id);
    if (!fromNode) continue;
    const endNodeId = `${state.id}__end`;
    endNodes.push({
      id: endNodeId,
      type: "end",
      name: `${state.name} — end call`,
      speak_during_execution: true,
      instruction: {
        type: "prompt",
        text: "Thank the caller, confirm there's nothing else you can help with, and say a warm goodbye.",
      },
    });
    if (fromNode.type === "transfer_call" || fromNode.type === "end") continue;
    fromNode.edges ??= [];
    fromNode.edges.push({
      id: `edge_${state.id}_end`,
      destination_node_id: endNodeId,
      transition_condition: {
        type: "prompt",
        prompt: "this state's business is fully done and the caller has nothing further to discuss",
      },
    });
  }

  // DISCLOSE-1 (mirrors template-compiler.ts): the static opening node,
  // built LAST so it copies the start state's final edge set — the caller's
  // first reply routes exactly as it did when the start state spoke first;
  // anything else falls through `else_edge` to the start state.
  const openingNode: RetellConversationNode = {
    id: OPENING_NODE_ID,
    type: "conversation",
    name: "Opening — AI and recording disclosure",
    instruction: { type: "static_text", text: opening.text },
    // DISCLOSE-1 review (mirrors template-compiler.ts): the caller cannot cut
    // the disclosure off — Retell's documented recording-disclaimer setup.
    interruption_sensitivity: OPENING_INTERRUPTION_SENSITIVITY,
    edges:
      startNode && (startNode.type === "conversation" || startNode.type === "subagent")
        ? (startNode.edges ?? []).map((edge) => ({ ...edge, id: `opening_${edge.id}` }))
        : [],
    else_edge: {
      id: "edge_opening_else",
      destination_node_id: startStateId,
      transition_condition: { type: "prompt", prompt: "Else" },
    },
  };

  // CALL-4 ("FAQ-only calls never hang up"): a single generic wrap-up
  // escape, reachable from anywhere via Retell's global-node mechanism —
  // see this file's header comment. Mirrors template-compiler.ts exactly
  // (DISCLOSE-1: "yes, another request" loops back to the start STATE,
  // never the static opening node, which would replay the greeting).
  const WRAP_UP_NODE_ID = "__wrap_up";
  const WRAP_UP_END_NODE_ID = "__wrap_up_end";
  const wrapUpNode: RetellConversationNode = {
    id: WRAP_UP_NODE_ID,
    type: "conversation",
    name: "Wrap-up",
    instruction: {
      type: "prompt",
      text: 'Ask the caller: "Is there anything else I can help with?" and wait for their answer.',
    },
    edges: [
      {
        id: "edge_wrap_up_to_end",
        destination_node_id: WRAP_UP_END_NODE_ID,
        transition_condition: {
          type: "prompt",
          prompt:
            "The caller says no, they're all set, or otherwise indicates they have nothing further",
        },
      },
      {
        id: "edge_wrap_up_to_start",
        destination_node_id: startStateId,
        transition_condition: {
          type: "prompt",
          prompt: "The caller says yes and has another request or question",
        },
      },
    ],
    global_node_setting: {
      // CALL-7 (docs/BUILD_NOTES.md): mirrors the live Deno compiler's
      // live-confirmed fix — a caller who never states any business
      // request (only asks "are you an AI?" then says goodbye) had no
      // matching edge anywhere, so the model just re-rendered the start
      // node's own instruction turn after turn. Widened to also cover the
      // caller saying goodbye / indicating they're done with NOTHING
      // resolved yet.
      condition:
        "The caller's current question or request has just been fully answered or handled " +
        "(for example an FAQ about hours or pricing) and nothing else in this call is actively " +
        "in progress, so it's a natural moment to check whether they need anything else; OR the " +
        "caller says goodbye, thanks you, or otherwise indicates they're done with the call even " +
        "though nothing was actually resolved yet (for example they declined to book or ask " +
        "anything after the greeting).",
    },
  };
  const wrapUpEndNode: RetellEndNode = {
    id: WRAP_UP_END_NODE_ID,
    type: "end",
    name: "Wrap-up — end call",
    speak_during_execution: true,
    instruction: { type: "prompt", text: "Thank the caller and say a warm goodbye." },
  };

  const flow: RetellConversationFlowRequest = {
    start_node_id: OPENING_NODE_ID,
    start_speaker: "agent",
    nodes: [openingNode, ...nodesById.values(), ...endNodes, wrapUpNode, wrapUpEndNode],
    tools,
    default_dynamic_variables: { ...COMPILER_DEFAULT_DYNAMIC_VARIABLES },
  };
  // SETTINGS-2: the owner-info block is part of every compile target's global prompt.
  flow.global_prompt = template.system_prompt
    ? `${template.system_prompt}\n\n${OWNER_INFO_INSTRUCTIONS}`
    : OWNER_INFO_INSTRUCTIONS;
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
      // CALL-7 (docs/BUILD_NOTES.md): mirrors the live Deno compiler's
      // dedup fix for a real, live-confirmed Retell rejection ("Destination
      // states must be unique for a particular state") when one node has
      // two edges to the same destination — not currently reachable by any
      // shipped template (every `global_intents` entry today uses
      // `reachable_from: "any"`, handled above), kept in sync defensively.
      if (fromNode.edges.some((e) => e.destination_node_id === globalIntent.target_state)) {
        continue;
      }
      fromNode.edges.push({
        id: `global_${globalIntent.name}_${fromStateId}_${globalIntent.target_state}`,
        destination_node_id: globalIntent.target_state,
        transition_condition: { type: "prompt", prompt: globalIntent.description },
      });
    }
  }
}
