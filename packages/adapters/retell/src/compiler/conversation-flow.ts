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
 * - The FIRST declared state (`template.states[0]`) is the entry node — its
 *   `id` becomes `start_node_id`, and `disclosure_line` is prepended
 *   verbatim to its instruction text (G1/G2). The start state ALWAYS
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

const NO_TRANSFER_FALLBACK_INSTRUCTION =
  "No live transfer line is configured for this business right now. Once, clearly and " +
  "warmly, say so and offer to take down their name, phone number, and a short message so " +
  "the team can call them back — never repeat that same apology/offer a third time. If they " +
  "give a callback number, call take_message with it (fold in whatever they've already told " +
  "you) and let them know someone will call back soon, then the call is done. If they keep " +
  "insisting on a transfer or won't give a number after you've offered twice, don't keep " +
  "repeating yourself: calmly acknowledge you can't do more right now and that's the end of " +
  "what you can help with today — the call is done either way.";

/** PUBLISH-1: mirrors `_shared/compiler/template-compiler.ts`'s identical
 * constant exactly — the transfer-only router node's instruction, a
 * genuine runtime decision (the live `transfer_number` dynamic variable's
 * actual value) instead of the compile-time either/or CALL-4 originally
 * used. */
const TRANSFER_ROUTER_INSTRUCTION =
  "The live transfer number for this business right now is: {{transfer_number}}. If that is a " +
  "real, non-empty phone number, say once, briefly and warmly, that you're connecting them to " +
  "a team member now — do not call take_message in that case. If it is empty/blank: " +
  NO_TRANSFER_FALLBACK_INSTRUCTION;

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
 * PUBLISH-1 (docs/BUILD_NOTES.md, mirrors `_shared/compiler/template-
 * compiler.ts` exactly): a transfer-only state now ALWAYS compiles to a
 * router node (kept at the state's own id, so every existing incoming edge
 * still resolves) plus a dedicated `${state.id}__transfer`
 * `TransferCallNode` — never a compile-time either/or on whether a
 * transfer number happens to be configured. The router's own edge onto
 * the transfer node is evaluated per call, against the LIVE
 * `transfer_number` dynamic variable, so a tenant's transfer-number change
 * takes effect on the very next call, no republish needed. `knownToolNames`
 * mirrors that file's `toolsByName` guard (defensive: a state authoring
 * bug referencing a name absent from `template.tools` must never leak into
 * `tool_ids`, which Retell rejects outright).
 */
function buildTransferOnlyNodes(
  state: AgentState,
  knownToolNames: Set<string>,
): RetellConversationFlowNode[] {
  const transferNodeId = `${state.id}__transfer`;
  const transferNode: RetellTransferCallNode = {
    id: transferNodeId,
    type: "transfer_call",
    name: `${state.name} — live transfer`,
    transfer_destination: { type: "predefined", number: TRANSFER_NUMBER_TOKEN },
    // Warm transfer — SYSTEM_DESIGN §4.5: "warm transfers always carry a context summary".
    transfer_option: { type: "warm_transfer" },
    edge: {
      id: `${state.id}_transfer_failed`,
      // Every shipped transfer-only state is `is_terminal: true`, so
      // `${state.id}__end` always exists once the is_terminal pass below
      // runs; omitted (rather than an explicit `undefined`, disallowed by
      // this workspace's `exactOptionalPropertyTypes`) for the
      // never-happens defensive case, never a caller- or
      // model-influenced value either way.
      ...(state.is_terminal ? { destination_node_id: `${state.id}__end` } : {}),
      // PUBLISH-1 (docs/BUILD_NOTES.md, mirrors template-compiler.ts
      // exactly): RETELL-VERIFIED live 2026-09-21 — a TransferCallNode's
      // `edge.transition_condition` is NOT free text like every other
      // node's edges; its JSON schema requires `prompt` to be the LITERAL
      // string "Transfer failed", nothing else.
      transition_condition: { type: "prompt", prompt: "Transfer failed" },
    },
  };

  const toolIds = [TAKE_MESSAGE_TOOL_NAME].filter((name) => knownToolNames.has(name));
  const hasTransferEdge: RetellFlowEdge[] = [
    {
      id: `edge_${state.id}_has_transfer`,
      destination_node_id: transferNodeId,
      transition_condition: {
        type: "prompt",
        prompt:
          "The transfer_number value for this call ({{transfer_number}}) is a real, non-empty " +
          "phone number — a live transfer number is available for this business right now.",
      },
    },
  ];
  // CALL-4 live-iteration fix (mirrors template-compiler.ts exactly): the
  // generic is_terminal end-edge ("the caller has nothing further to
  // discuss") requires the CALLER to drop the topic — an adversarial
  // caller who keeps repeating the same transfer demand after the agent
  // has already clearly declined twice never satisfies that wording, so
  // the call stalls here and Retell's own loop-detector aborts it
  // (live-confirmed, docs/BUILD_NOTES.md CALL-4). This router node gets
  // its own EXTRA edge to that same end node whose condition is satisfied
  // by the AGENT's own turn instead — it doesn't need the caller's
  // agreement.
  const fallbackDoneEdges: RetellFlowEdge[] = state.is_terminal
    ? [
        {
          id: `edge_${state.id}_fallback_done`,
          destination_node_id: `${state.id}__end`,
          transition_condition: {
            type: "prompt",
            prompt:
              "you have already clearly told the caller no live transfer is available and " +
              "offered to take a message at least once — end here even if the caller keeps " +
              "repeating the same request",
          },
        },
      ]
    : [];

  // FOLLOWUP-1 (docs/BUILD_NOTES.md QA-HOT/FOLLOWUP-1): mirrors the
  // template-compiler.ts fix exactly. This router node's instruction used
  // to be the generic `TRANSFER_ROUTER_INSTRUCTION` ALONE, discarding the
  // state's OWN authored `prompt_fragment` entirely — unlike `buildNode`'s
  // equivalent branch above, which always keeps both. Same live-observed
  // bug QA-HOT root-caused in the Deno compiler (vet's
  // `emergency_warm_transfer` state losing its own emergency-specific
  // content the instant it compiled here). Now combined the same way.
  const routerInstructionText = `${state.prompt_fragment}\n\n${TRANSFER_ROUTER_INSTRUCTION}`;

  const routerNode: RetellConversationFlowNode =
    toolIds.length > 0
      ? ({
          id: state.id,
          type: "subagent",
          name: state.name,
          instruction: { type: "prompt", text: routerInstructionText },
          edges: [...hasTransferEdge, ...fallbackDoneEdges],
          tool_ids: toolIds,
        } satisfies RetellSubagentNode)
      : ({
          id: state.id,
          type: "conversation",
          name: state.name,
          instruction: { type: "prompt", text: routerInstructionText },
          edges: [...hasTransferEdge, ...fallbackDoneEdges],
        } satisfies RetellConversationNode);

  return [routerNode, transferNode];
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
      parameters: {
        type: "object",
        properties: tool.parameters.properties ?? {},
        ...(tool.parameters.required !== undefined ? { required: tool.parameters.required } : {}),
      },
      ...(singleLockedToolNames.has(tool.name)
        ? { speak_during_execution: true, speak_after_execution: true }
        : {}),
    }));
  const knownToolNames = new Set(tools.map((t) => t.name));
  knownToolNames.add(TAKE_MESSAGE_TOOL_NAME); // always grantable to the no-transfer-number fallback if declared

  const nodesById = new Map<string, RetellConversationFlowNode>();
  for (const state of template.states) {
    const isStart = state.id === startState?.id;
    // PUBLISH-1: a transfer-only state (never the start state, see this
    // file's header) compiles to TWO nodes now — see `buildTransferOnlyNodes`.
    if (!isStart && isTransferOnlyState(state)) {
      for (const node of buildTransferOnlyNodes(state, knownToolNames)) {
        nodesById.set(node.id, node);
      }
      continue;
    }
    nodesById.set(state.id, buildNode(state, isStart, knownToolNames));
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

  // CALL-2/CALL-4 (mirrors template-compiler.ts): every `is_terminal` state
  // gets its own `end` node plus one edge onto it, so the flow always has
  // somewhere to go once that state's business is done. A transfer_call
  // node's own `edge` (built above) already targets this exact id — it has
  // no `.edges` array to push onto, so it's skipped here, not double-wired.
  const endNodes: RetellEndNode[] = [];
  for (const state of template.states) {
    if (!state.is_terminal) continue;
    const fromNode = nodesById.get(state.id);
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

  // CALL-4 ("FAQ-only calls never hang up"): a single generic wrap-up
  // escape, reachable from anywhere via Retell's global-node mechanism —
  // see this file's header comment. Mirrors template-compiler.ts exactly.
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
        destination_node_id: startNodeId,
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
    start_node_id: startNodeId,
    start_speaker: "agent",
    nodes: [...nodesById.values(), ...endNodes, wrapUpNode, wrapUpEndNode],
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
