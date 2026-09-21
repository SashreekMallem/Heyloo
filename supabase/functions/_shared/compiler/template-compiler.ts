/**
 * Lean, portable re-implementation of `packages/adapters/retell/src/
 * compiler/*` (T2) for the `/admin-templates/:id/publish` endpoint
 * (BACKEND_SPEC §7.7: "publish runs the compiler + Retell adapter publish
 * call"). This is a DELIBERATE duplication, not a shortcut: `admin` is a
 * Deno Edge Function and `packages/adapters/retell` is a Node-only pnpm
 * workspace package (zero bundling step exists to cross that boundary — see
 * `packages/adapters/README.md` and the provider-isolation note in
 * `docs/BUILD_NOTES.md`'s T3 entry) — the SAME reason every other vendor
 * call under `supabase/functions/` goes through a lean
 * `_shared/providers/<vendor>.ts` fetch client instead of importing a
 * `packages/adapters/*` SDK-style module. This module is that pattern
 * applied to the compiler's pure data-transformation logic rather than a
 * vendor's REST client.
 *
 * Operates directly on `agent_templates`' jsonb column shapes (duck-typed
 * interfaces below, not the canonical-types Zod schema — that package has
 * the identical Node-only import problem) rather than on the canonical
 * `AgentTemplate` TypeScript type. Structural validity (every transition/
 * global-intent/allowed_tools reference resolving to a declared state or
 * tool) is enforced at template-authoring time by
 * `packages/canonical-types`' schema (T2) before a row is ever written here
 * — this compiler defends against a malformed reference the same way T2's
 * did, by silently skipping it, never throwing.
 *
 * FOLLOW-UP (docs/BUILD_NOTES.md): the real fix is extracting the compiler's
 * pure logic into a zero-runtime-dependency package importable by both Node
 * and Deno (`npm:` specifier once published, or a bundled single-file
 * build) so this duplication can be deleted — tracked, not attempted here
 * given T4's scope.
 */

export interface CompilerAgentState {
  id: string;
  name: string;
  prompt_fragment: string;
  allowed_tools: string[];
  /** CALL-2 (docs/BUILD_NOTES.md): previously declared on the canonical
   * `AgentState` type but never read by this compiler at all — see
   * `EndNode`'s own doc comment for the live bug that left unfixed. */
  is_terminal?: boolean;
}

export interface CompilerTransition {
  from: string;
  to: string;
  on?: { intent?: string; predicate?: string };
}

export interface CompilerGlobalIntent {
  name: string;
  target_state: string;
  reachable_from: "any" | string[];
  description: string;
}

export interface CompilerTool {
  name: string;
  description: string;
  parameters: unknown;
}

export interface CompilerAgentTemplate {
  compile_target: "conversation_flow" | "multi_prompt" | "single_prompt";
  system_prompt: string | null;
  states: CompilerAgentState[];
  transitions: CompilerTransition[];
  global_intents: CompilerGlobalIntent[];
  tools: CompilerTool[];
  disclosure_line: string;
}

interface FunctionTool {
  type: "custom";
  tool_id: string;
  name: string;
  description: string;
  url: string;
  parameters: unknown;
}

/** The one reserved tool name `transferCallTool()` always uses (`packages/templates/src/shared/tools.ts`) — never a real HTTP `/voice-tools` call, a native Retell transfer-call node instead (see `TransferCallNode` below). */
const TRANSFER_CALL_TOOL_NAME = "transfer_call";
/** The shared take-message tool every vertical declares (`packages/templates/src/shared/tools.ts#takeMessageTool`) — granted, compiler-side only, to a transfer-only state when no `transferNumber` is configured (CALL-4's spoken-fallback design, this file's header). */
const TAKE_MESSAGE_TOOL_NAME = "take_message";

function toolsFor(template: CompilerAgentTemplate, toolWebhookUrl: string): FunctionTool[] {
  return template.tools.map((tool) => ({
    type: "custom" as const,
    // CALL-1 gap fix (docs/BUILD_NOTES.md): confirmed live against
    // docs.retellai.com/api-references/create-conversation-flow
    // 2026-09-20 — every `tools[]` entry requires a caller-generated
    // `tool_id` (`request/body/tools/0 must have required property
    // 'tool_id'`, seen verbatim from a real 400 response). Tool `name` is
    // already required to be unique within a template's tool set, so it
    // doubles as a stable, deterministic `tool_id` — never randomly
    // generated, so recompiling the same template produces an identical
    // flow body (idempotent, diff-friendly).
    tool_id: tool.name,
    name: tool.name,
    description: tool.description,
    url: toolWebhookUrl,
    // `properties` is REQUIRED per retell-typescript-sdk's `CustomTool.
    // Parameters`, confirmed RETELL-VERIFY — default an omitted one to `{}`
    // (mirrors packages/adapters/retell/src/compiler/*.ts's identical fix).
    parameters:
      tool.parameters && typeof tool.parameters === "object"
        ? { properties: {}, ...tool.parameters }
        : { type: "object", properties: {} },
  }));
}

// ---------------------------------------------------------------------
// conversation_flow
// ---------------------------------------------------------------------

interface ConversationNode {
  id: string;
  // CALL-2 (docs/BUILD_NOTES.md): RETELL-VERIFIED live 2026-09-20
  // (docs.retellai.com/build/conversation-flow/overview,
  // /api-references/create-conversation-flow) — VERIFY-8's prior
  // resolution was half right and half wrong. Right: `tool_ids` is not a
  // field on a plain `"conversation"` node. WRONG conclusion drawn from
  // that: dropping `tool_ids` entirely rather than switching a tool-
  // backed state to the node type that DOES support it. The docs are
  // explicit and load-bearing here: "Conversation nodes do not use tools /
  // functions" — a `"conversation"` node's LLM can NEVER invoke a tool,
  // full stop, no matter what the flow's top-level `tools[]` contains or
  // what the node's own prompt text says to do. `"subagent"` is the node
  // type built for exactly this ("dialogue with tool calling") — same
  // `instruction`/`edges`/`global_node_setting` shape a `"conversation"`
  // node has, plus `tool_ids`. This was a real, live, silent bug: EVERY
  // node this compiler ever emitted was `"conversation"`, so no
  // conversation-flow agent this platform has ever compiled could call
  // ANY tool — confirmed against a real batch-test transcript
  // (`docs/BUILD_NOTES.md` CALL-2): the agent verbatim says "I don't have
  // the ability to see availability directly," then hallucinates a
  // booking confirmation instead of ever calling `create_booking`, then
  // loops repeating that confirmation until Retell's loop-detector aborts
  // the call — exactly the "Ending the conversation early as there might
  // be a loop" result CALL-1 saw on 7/8 scenarios, not (only) the
  // call-context-resolution gap CALL-1 traced it to. SYSTEM_DESIGN §4.1's
  // own stated design for conversation_flow is "tool-backed nodes only" —
  // this fixes the compiler to actually implement that, matching what
  // `compileMultiPrompt` below already does per-state via the same
  // `state.allowed_tools` field.
  type: "conversation" | "subagent";
  name: string;
  instruction: { type: "prompt"; text: string };
  edges: Array<{
    id: string;
    destination_node_id: string;
    transition_condition: { type: "prompt"; prompt: string };
  }>;
  // `global_node_setting: {condition}` — confirmed an object with a
  // REQUIRED `condition` string (VERIFY-8). See
  // packages/adapters/retell/src/compiler/types.ts for the full
  // resolved-shape writeup (this file is a deliberate duplicate of that
  // package's compiler, kept in sync — BUILD_NOTES T4/T3).
  global_node_setting?: { condition: string };
  /** Only present (and only valid) when `type === "subagent"` — the
   * flow-level `tools[].tool_id` values (== `tool.name`, CALL-1's
   * `tool_id: tool.name` convention) this node's LLM may call. */
  tool_ids?: string[];
}

/**
 * CALL-2 (docs/BUILD_NOTES.md): RETELL-VERIFIED live 2026-09-20
 * (retell-typescript-sdk's `EndNode` interface, `src/resources/
 * conversation-flow.ts` — docs.retellai.com/build/conversation-flow/node
 * corroborates the field names but not a full schema on its own). A real,
 * live-confirmed bug this fixes: `template.states[].is_terminal` was
 * NEVER read by this compiler (only referenced in test fixtures/other
 * packages) — an `is_terminal` state compiled to an ordinary
 * conversation/subagent node with no edge onward, so once the model
 * finished that state (e.g. `confirm_booking` right after a successful
 * `create_booking`) there was nowhere for the flow to go: confirmed live,
 * the model just kept re-confirming/re-calling the same tool turn after
 * turn until Retell's own test-run timeout, never a clean call end.
 */
interface EndNode {
  id: string;
  type: "end";
  name?: string;
  speak_during_execution?: boolean;
  instruction?: { type: "prompt"; text: string };
  // CALL-4: shared by the same mechanism as `ConversationNode.
  // global_node_setting` (RETELL-VERIFIED against the real retell-sdk
  // TypeScript source, `node_modules/retell-sdk/src/resources/
  // conversation-flow.ts` — `ConversationFlowCreateParams.EndNode.
  // global_node_setting?: EndNode.GlobalNodeSetting` — every node type this
  // compiler emits carries this same optional field). Used by the generic
  // wrap-up node below so it's reachable from anywhere in the flow, not
  // just from a state with an authored edge onto it.
  global_node_setting?: { condition: string };
}

/**
 * CALL-4 (docs/BUILD_NOTES.md): RETELL-VERIFIED field-for-field against the
 * real retell-sdk TypeScript source (`node_modules/retell-sdk/src/
 * resources/conversation-flow.ts`, `ConversationFlowCreateParams.
 * TransferCallNode` — also cross-checked against docs.retellai.com/
 * api-references/create-conversation-flow, both fetched 2026-09-20, see
 * docs/VERIFY.md). `edge` is a SINGULAR required field (not an array) —
 * the "transfer failed" fallback path only; a successful transfer bridges
 * the call away from this flow entirely, no further routing needed here.
 * `transfer_destination.number` accepts either a literal E.164 string or a
 * `{{dynamic_variable}}` placeholder per the SDK's own doc comment — this
 * compiler always bakes the LITERAL number in directly (never the
 * `{{transfer_number}}` indirection `packages/adapters/retell`'s Node
 * sibling previously used) because the destination is resolved HERE, at
 * compile time, from `agent_configs.transfer_number` (G6, CLAUDE.md Rule 2:
 * "transfer_call destinations tenant-config only") — see
 * `compileConversationFlow`'s `transferNumber` option below for the
 * no-number-configured fallback this enables.
 */
interface TransferCallNode {
  id: string;
  type: "transfer_call";
  name: string;
  transfer_destination: { type: "predefined"; number: string };
  // Warm transfer — SYSTEM_DESIGN §4.5: "warm transfers always carry a
  // context summary". `{type: "warm_transfer"}` alone is a complete, valid
  // value (every other `TransferOptionWarmTransfer` field is optional,
  // RETELL-VERIFIED against the real SDK source).
  transfer_option: { type: "warm_transfer" };
  edge: {
    id: string;
    destination_node_id: string;
    transition_condition: { type: "prompt"; prompt: string };
  };
  global_node_setting?: { condition: string };
  /** Unused by this compiler (never the start node, see `compileConversationFlow`'s guard) — declared only so `firstTurnText`'s `.instruction?.text` narrows across the whole node union without a discriminant check. RETELL-VERIFIED present on the real node (`"What to say when transferring the call, only used when speak during execution"`). */
  instruction?: { type: "prompt"; text: string };
}

export interface ConversationFlowBody {
  start_node_id: string;
  // REQUIRED on ConversationFlowCreateParams (RETELL-VERIFY, confirmed via
  // retell-typescript-sdk) — always "agent": every template opens with the
  // agent's own greeting/disclosure line, never a user-speaks-first flow.
  start_speaker: "agent";
  nodes: (ConversationNode | EndNode | TransferCallNode)[];
  tools: FunctionTool[];
  global_prompt?: string;
}

export interface CompileConversationFlowOptions {
  /**
   * CALL-4: `agent_configs.transfer_number` (E.164), resolved by the
   * CALLER (this tenant's own config row) and never anything else — G6 /
   * CLAUDE.md Rule 2 ("transfer_call destinations tenant-config only").
   * When set (non-empty), a transfer-only state (`allowed_tools ===
   * ["transfer_call"]`, e.g. every template's shared `transferToHumanState()`)
   * compiles to a native `TransferCallNode` whose destination is this
   * literal number. When unset/empty — a tenant that hasn't configured a
   * transfer number yet — that same state compiles to a spoken fallback
   * instead: an ordinary node instructed to apologize and take a message,
   * granted the `take_message` tool for this one node only (never a
   * transfer node with nowhere real to send the call, and never a silent
   * dead end either).
   */
  transferNumber?: string | null;
}

function isTransferOnlyState(state: CompilerAgentState): boolean {
  return state.allowed_tools.length === 1 && state.allowed_tools[0] === TRANSFER_CALL_TOOL_NAME;
}

const NO_TRANSFER_FALLBACK_INSTRUCTION =
  "No live transfer line is configured for this business right now. Once, clearly and " +
  "warmly, say so and offer to take down their name, phone number, and a short message so " +
  "the team can call them back — never repeat that same apology/offer a third time. If they " +
  "give a callback number, call take_message with it (fold in whatever they've already told " +
  "you) and let them know someone will call back soon, then the call is done. If they keep " +
  "insisting on a transfer or won't give a number after you've offered twice, don't keep " +
  "repeating yourself: calmly acknowledge you can't do more right now and that's the end of " +
  "what you can help with today — the call is done either way.";

/** CALL-7 (docs/BUILD_NOTES.md): `compileMultiPrompt`/`compileSinglePrompt`
 * append this onto `NO_TRANSFER_FALLBACK_INSTRUCTION` above (conversation_
 * flow never does — it has no `end_call` tool/concept, it forces the exit
 * structurally via a dedicated edge instead, CALL-4). Without this, a real
 * batch-test transcript showed the model still gently re-offering to take a
 * message turn after turn against an adversarial caller who keeps refusing
 * to leave one — technically obeying "don't repeat the same apology" (each
 * turn's wording genuinely varied) while never actually calling `end_call`,
 * which still reads as a loop to Retell's own detector. Explicit and
 * unconditional: hang up yourself, don't wait for the caller's agreement. */
const NO_TRANSFER_FALLBACK_END_CALL_SUFFIX =
  " Once you've offered to take a message twice (whether or not they gave you a callback " +
  "number), you MUST call the end_call tool yourself right then, no matter what the caller " +
  "says next — even if they explicitly ask you not to hang up, keep insisting, or repeat the " +
  "same demand a third time. Do not wait for the caller to agree or say goodbye first, do not " +
  "send them back through the same offer again, and do not let them talk you out of ending " +
  "the call once you've reached this point — there is nothing more you can do for them on " +
  "this call, and continuing to repeat yourself helps no one.";

function compileConversationFlow(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
  options: CompileConversationFlowOptions = {},
): ConversationFlowBody {
  const transferNumber = options.transferNumber?.trim() || null;
  // transfer_call is never a real HTTP `/voice-tools` call (it compiles to
  // a native TransferCallNode below, or is dropped entirely for the
  // no-transfer-number fallback) — excluded from the flow's top-level
  // custom-function tools list so Retell never sees a bogus webhook tool
  // named "transfer_call" (CALL-4 fix; previously included unfiltered).
  const tools = toolsFor(template, toolWebhookUrl).filter(
    (t) => t.name !== TRANSFER_CALL_TOOL_NAME,
  );

  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const nodesById = new Map<string, ConversationNode | TransferCallNode>();
  for (const state of template.states) {
    const transferOnly = isTransferOnlyState(state);

    if (transferOnly && transferNumber) {
      nodesById.set(state.id, {
        id: state.id,
        type: "transfer_call",
        name: state.name,
        transfer_destination: { type: "predefined", number: transferNumber },
        transfer_option: { type: "warm_transfer" },
        // Destination filled in once the is_terminal end-node pass below
        // creates `${state.id}__end` — every shipped transferOnly state is
        // `is_terminal: true` (transferToHumanState()), so this always
        // resolves; defensively falls back to the state id itself (a
        // no-op edge Retell will reject loudly rather than silently drop)
        // if a future template ever violates that assumption.
        edge: {
          id: `${state.id}_transfer_failed`,
          destination_node_id: state.is_terminal ? `${state.id}__end` : state.id,
          transition_condition: {
            type: "prompt",
            prompt: "The transfer failed, rang out, or nobody answered",
          },
        },
      });
      continue;
    }

    // Only tool_ids Retell actually knows about (defensive — a state
    // authoring bug referencing a name absent from template.tools would
    // otherwise produce a tool_ids entry Retell rejects outright). A
    // transfer-only state with no transferNumber configured is granted
    // take_message instead of its authored (now-unusable) transfer_call.
    const requestedTools = transferOnly ? [TAKE_MESSAGE_TOOL_NAME] : (state.allowed_tools ?? []);
    const toolIds = requestedTools.filter((name) => toolsByName.has(name));
    // CALL-4 live-iteration fix: the generic is_terminal end-edge below
    // ("the caller has nothing further to discuss") requires the CALLER to
    // drop the topic — an adversarial caller who keeps repeating the same
    // transfer demand after the agent has already clearly declined twice
    // never satisfies that wording, so the call stalls at this node and
    // Retell's own loop-detector aborts it (live-confirmed:
    // `docs/BUILD_NOTES.md` CALL-4). This fallback node gets its own EXTRA
    // edge to that same end node whose condition is satisfied by the
    // AGENT's own turn instead — it doesn't need the caller's agreement.
    const fallbackDoneEdge =
      transferOnly && state.is_terminal
        ? [
            {
              id: `edge_${state.id}_fallback_done`,
              destination_node_id: `${state.id}__end`,
              transition_condition: {
                type: "prompt" as const,
                prompt:
                  "you have already clearly told the caller no live transfer is available and " +
                  "offered to take a message at least once — end here even if the caller keeps " +
                  "repeating the same request",
              },
            },
          ]
        : [];
    nodesById.set(state.id, {
      id: state.id,
      type: toolIds.length > 0 ? "subagent" : "conversation",
      name: state.name,
      instruction: {
        type: "prompt",
        text: transferOnly ? NO_TRANSFER_FALLBACK_INSTRUCTION : state.prompt_fragment,
      },
      edges: fallbackDoneEdge,
      ...(toolIds.length > 0 ? { tool_ids: toolIds } : {}),
    });
  }

  for (const [index, transition] of template.transitions.entries()) {
    const fromNode = nodesById.get(transition.from);
    // transfer_call nodes have no `edges` array (a single required `edge`
    // only, set above) — no shipped template authors an outgoing
    // transition from a transfer-only state today (it's always
    // is_terminal), but guard it the same way the is_terminal pass below
    // does rather than throw.
    if (!fromNode || fromNode.type === "transfer_call" || !nodesById.has(transition.to)) continue;
    fromNode.edges.push({
      id: `edge_${transition.from}_${transition.to}_${index}`,
      destination_node_id: transition.to,
      transition_condition: {
        type: "prompt",
        prompt: transition.on?.intent ?? transition.on?.predicate ?? "",
      },
    });
  }

  for (const globalIntent of template.global_intents) {
    const targetNode = nodesById.get(globalIntent.target_state);
    if (!targetNode) continue;
    if (globalIntent.reachable_from === "any") {
      targetNode.global_node_setting = { condition: globalIntent.description };
      continue;
    }
    for (const fromStateId of globalIntent.reachable_from) {
      const fromNode = nodesById.get(fromStateId);
      if (!fromNode || fromNode.type === "transfer_call") continue;
      // CALL-7: same dedup guard as `compileMultiPrompt`'s live-confirmed
      // fix below (see that function's own doc comment) — not currently
      // reachable by any shipped template (every `global_intents` entry
      // today uses `reachable_from: "any"`, handled by the branch above
      // instead), kept in sync defensively so an explicit-list global
      // intent never reintroduces the same duplicate-destination class of
      // bug if one is ever authored.
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

  const startState = template.states[0];
  const startNodeId = startState?.id ?? "";
  if (startState) {
    const startNode = nodesById.get(startState.id);
    // The start state is never a transfer-only state in any shipped
    // template (see this file's own compileTemplate doc comment history /
    // packages/adapters/retell's identical documented assumption) — guard
    // defensively rather than assume.
    if (startNode && startNode.type !== "transfer_call") {
      startNode.instruction.text = `${template.disclosure_line}\n\n${startNode.instruction.text}`;
    }
  }

  // CALL-2: every `is_terminal` state gets its own `end` node plus one
  // edge onto it, so the flow actually has somewhere to go once that
  // state's business is done — see `EndNode`'s own doc comment for the
  // live bug this closes (no edge onward -> the model stalls, repeating
  // the same turn/tool call forever instead of ending the call).
  const endNodes: EndNode[] = [];
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
    // A transfer_call node's own `edge` (set above) already targets this
    // exact end-node id — nothing further to wire onto it, and it has no
    // `.edges` array to push onto anyway.
    if (fromNode.type === "transfer_call") continue;
    fromNode.edges.push({
      id: `edge_${state.id}_end`,
      destination_node_id: endNodeId,
      transition_condition: {
        type: "prompt",
        prompt: "this state's business is fully done and the caller has nothing further to discuss",
      },
    });
  }

  // CALL-4 (docs/BUILD_NOTES.md "FAQ-only calls never hang up"): a single
  // generic wrap-up escape, reachable from ANYWHERE in the flow via
  // Retell's global-node mechanism (the same mechanism every authored
  // `global_intents` "reachable_from: any" entry already uses) — not tied
  // to any one vertical's state ids. Two nodes, matching the task's own
  // "Is there anything else I can help with?" -> no -> end shape: a
  // conversation node asks the question and either loops back to the
  // flow's start node (the caller has another request) or proceeds to a
  // true end node (they don't). This is what closes the gap `is_terminal`
  // end-nodes above don't cover: a state like `greeting` that answers an
  // FAQ inline and is never itself `is_terminal` (it's also the booking
  // entry point, so it can't always be).
  const WRAP_UP_NODE_ID = "__wrap_up";
  const WRAP_UP_END_NODE_ID = "__wrap_up_end";
  const wrapUpNode: ConversationNode = {
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
      // CALL-7 (docs/BUILD_NOTES.md): live-confirmed gap — the original
      // condition only covered "a request was just answered", so a caller
      // who never states any business request at all (e.g. asks only
      // "are you an AI?" and then says goodbye without ever booking/
      // asking an FAQ) had no matching edge anywhere in the flow. With
      // nowhere to go, the model just re-rendered the start node's own
      // instruction (disclosure line included) turn after turn — a real,
      // visible repeated-disclosure-line loop, not simulator noise,
      // confirmed via a live transcript that settled "Ending the
      // conversation early as there might be a loop." Widened to also
      // cover the caller saying goodbye / indicating they're done with
      // NOTHING resolved yet, not only after something was.
      condition:
        "The caller's current question or request has just been fully answered or handled " +
        "(for example an FAQ about hours or pricing) and nothing else in this call is actively " +
        "in progress, so it's a natural moment to check whether they need anything else; OR the " +
        "caller says goodbye, thanks you, or otherwise indicates they're done with the call even " +
        "though nothing was actually resolved yet (for example they declined to book or ask " +
        "anything after the greeting).",
    },
  };
  const wrapUpEndNode: EndNode = {
    id: WRAP_UP_END_NODE_ID,
    type: "end",
    name: "Wrap-up — end call",
    speak_during_execution: true,
    instruction: { type: "prompt", text: "Thank the caller and say a warm goodbye." },
  };

  const body: ConversationFlowBody = {
    start_node_id: startNodeId,
    start_speaker: "agent",
    nodes: [...nodesById.values(), ...endNodes, wrapUpNode, wrapUpEndNode],
    tools,
  };
  if (template.system_prompt) body.global_prompt = template.system_prompt;
  return body;
}

// ---------------------------------------------------------------------
// multi_prompt
// ---------------------------------------------------------------------

/** CALL-7 (docs/BUILD_NOTES.md): the same native-transfer-tool design
 * `compileConversationFlow`'s `TransferCallNode` already uses (RETELL-
 * VERIFIED against the real retell-sdk TypeScript source's
 * `LlmCreateParams.TransferCallTool`, which shares this exact shape with
 * a Retell LLM's per-state `tools`/`general_tools`) — a multi_prompt
 * state's tool-call slot, not a node. */
interface MultiPromptTransferCallTool {
  type: "transfer_call";
  name: string;
  description?: string | undefined;
  transfer_destination: { type: "predefined"; number: string };
  transfer_option: { type: "warm_transfer" };
}

interface MultiPromptState {
  name: string;
  state_prompt: string;
  edges: Array<{ destination_state_name: string; description: string }>;
  tools: (FunctionTool | MultiPromptTransferCallTool)[];
}

interface EndCallTool {
  type: "end_call";
  name: string;
  description?: string;
}

export interface MultiPromptBody {
  general_prompt: string;
  starting_state: string;
  states: MultiPromptState[];
  /** CALL-7 (docs/BUILD_NOTES.md): RETELL-VERIFIED live (docs.retellai.com/
   * build/single-multi-prompt/end-call, corroborated by the real retell-sdk
   * TypeScript source's `LlmCreateParams.EndCallTool`) — a Retell LLM
   * response engine (single/multi-prompt) NEVER ends a call on its own; "By
   * default, the agent won't end the call automatically" — it must be
   * explicitly granted a `type: "end_call"` tool. This was missing
   * ENTIRELY from every multi_prompt template this platform has ever
   * compiled (`legal`, `real_estate`) — live-confirmed root cause of a 0/6
   * batch-test run where EVERY scenario, including a plain FAQ call,
   * settled `error: "Ending the conversation early as there might be a
   * loop"`: once the conversation's business was done, the model had no
   * way to actually hang up, so it and the simulated caller kept trading
   * near-identical goodbye turns until Retell's own loop-detector aborted
   * the call. `general_tools` (not a per-state field) makes it callable
   * from every state, matching `general_prompt`'s own "no matter what
   * state" semantics.
   */
  general_tools: EndCallTool[];
}

/** The general_prompt instruction that makes the `general_tools` end_call
 * tool (see `MultiPromptBody#general_tools`'s own doc comment) actually get
 * used — granting the tool alone doesn't tell the model WHEN to call it,
 * and an ungranted-but-unused tool leaves the exact same "never actually
 * hangs up" bug. Appended to every multi_prompt template's own
 * `system_prompt`, independent of any per-vertical authored content. */
const END_CALL_INSTRUCTION =
  "\n\nWhen the caller's request has been fully handled and they have nothing further to " +
  "discuss (they say goodbye, thank you, that's all, or similar, or you have already clearly " +
  "wrapped up the call), say a warm goodbye and then call the end_call tool to hang up. Never " +
  "just stop responding or repeat the same goodbye more than once — always end the call with " +
  "this tool once you've said goodbye.\n\n" +
  // CALL-8 (docs/BUILD_PLAN.md): live-observed real bug — a multi_prompt
  // template's own open, model-mediated conversation (by design, e.g.
  // legal's "open empathetic discovery a rigid graph would flatten") can
  // rush through several remaining questions in one turn, thank the caller,
  // and call end_call WITHOUT ever having called the tool that actually
  // records the call — the tool call Retell's own transcript-relevance
  // judge never checks for, so the call still grades "pass" even though
  // nothing was ever saved. This is a general risk for any multi_prompt/
  // single_prompt vertical, not specific to one, so it belongs here at the
  // compiler level rather than authored once per vertical.
  "Before you say goodbye or call end_call: if this call was ABOUT booking an appointment, " +
  "placing an order, or leaving a message/intake for the business to follow up on, you must " +
  "have ALREADY called the tool that actually records that (create_booking, create_order, or " +
  "take_message) earlier in this same call — never promise to record something, or act as if " +
  "you have, without having actually called that tool. If you realize you have not yet called " +
  "it, call it now (even with an incomplete set of fields — something recorded is always better " +
  "than nothing) before ending the call. This never applies to a call that was ONLY an FAQ " +
  "question, a transfer, or a cancellation with nothing new to record.";

function compileMultiPrompt(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
  options: CompileConversationFlowOptions = {},
): MultiPromptBody {
  const transferNumber = options.transferNumber?.trim() || null;
  // CALL-7 live-confirmed bug (docs/BUILD_NOTES.md): unlike
  // `compileConversationFlow` (CALL-4), this function NEVER special-cased
  // `transfer_call` — it compiled to an ordinary custom `/voice-tools`
  // webhook call, an unrecognized tool name that dispatcher (`voice-tools/
  // handler.ts`) always answers with the generic `fallbackEnvelope()`. Live
  // transcript evidence: the model called it 4 times in a row against an
  // insistent caller, each time getting back `{"result":{"fallback":true,
  // ...}}`, repeating "I'm transferring you now" each time — the exact
  // "Ending the conversation early as there might be a loop" failure mode.
  // Fixed identically to `compileConversationFlow`: a native
  // `MultiPromptTransferCallTool` when `transferNumber` is configured, the
  // same honest take_message-based spoken fallback (never a dead-end
  // custom-webhook call to a name nothing dispatches) when it isn't.
  const transferToolDescription = template.tools.find(
    (t) => t.name === TRANSFER_CALL_TOOL_NAME,
  )?.description;
  const tools = toolsFor(template, toolWebhookUrl).filter(
    (t) => t.name !== TRANSFER_CALL_TOOL_NAME,
  );
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const statesByName = new Map<string, MultiPromptState>();
  for (const state of template.states) {
    const transferOnly = isTransferOnlyState(state);

    if (transferOnly && transferNumber) {
      statesByName.set(state.id, {
        name: state.id,
        state_prompt: state.prompt_fragment,
        edges: [],
        tools: [
          {
            type: "transfer_call",
            name: TRANSFER_CALL_TOOL_NAME,
            description: transferToolDescription,
            transfer_destination: { type: "predefined", number: transferNumber },
            transfer_option: { type: "warm_transfer" },
          },
        ],
      });
      continue;
    }

    const requestedTools = transferOnly ? [TAKE_MESSAGE_TOOL_NAME] : (state.allowed_tools ?? []);
    statesByName.set(state.id, {
      name: state.id,
      state_prompt: transferOnly
        ? `${state.prompt_fragment}\n\n${NO_TRANSFER_FALLBACK_INSTRUCTION}${NO_TRANSFER_FALLBACK_END_CALL_SUFFIX}`
        : state.prompt_fragment,
      edges: [],
      tools: requestedTools
        .map((t) => toolsByName.get(t))
        .filter((t): t is FunctionTool => t !== undefined),
    });
  }

  for (const transition of template.transitions) {
    const fromState = statesByName.get(transition.from);
    if (!fromState || !statesByName.has(transition.to)) continue;
    // CALL-7 live-confirmed bug (docs/BUILD_NOTES.md): Retell's
    // create-retell-llm rejects a multi_prompt state with two edges to the
    // SAME destination state ("Destination states must be unique for a
    // particular state, found duplicate destination state: <id>") —
    // confirmed via a real 400 against `legal`'s compiled flow. Guarded
    // here too (not just the global_intents loop below) in case a future
    // template ever authors two transitions with the same from/to.
    if (fromState.edges.some((e) => e.destination_state_name === transition.to)) continue;
    fromState.edges.push({
      destination_state_name: transition.to,
      description: transition.on?.intent ?? transition.on?.predicate ?? "",
    });
  }

  for (const globalIntent of template.global_intents) {
    if (!statesByName.has(globalIntent.target_state)) continue;
    const sourceIds =
      globalIntent.reachable_from === "any"
        ? [...statesByName.keys()]
        : globalIntent.reachable_from;
    for (const sourceId of sourceIds) {
      if (sourceId === globalIntent.target_state) continue;
      const sourceState = statesByName.get(sourceId);
      if (!sourceState) continue;
      // CALL-7 (docs/BUILD_NOTES.md): the actual bug this session hit
      // live — a `reachable_from: "any"` global intent (e.g. legal's/
      // real_estate's "give_up" -> take_message_fallback) blindly added a
      // SECOND edge to a state that already had an authored `transitions`
      // edge to that exact same target (e.g. legal's own `greeting ->
      // take_message_fallback` on "after_hours_or_wants_to_leave_a_
      // message") — Retell's real 400 above, every time. A state having
      // multiple DIFFERENT reasons to reach the same destination is a
      // real, valid design (the caller can get there via either path);
      // only the destination itself needs to stay unique per Retell's own
      // constraint, so the two descriptions are never merged — the first
      // edge to claim a destination (authored transitions always run
      // first, above) simply wins, and every ADDITIONAL edge that would
      // have gone to the same already-covered destination is dropped as
      // structurally redundant to Retell either way.
      if (sourceState.edges.some((e) => e.destination_state_name === globalIntent.target_state)) {
        continue;
      }
      sourceState.edges.push({
        destination_state_name: globalIntent.target_state,
        description: globalIntent.description,
      });
    }
  }

  const startState = template.states[0];
  if (startState) {
    const compiledStart = statesByName.get(startState.id);
    if (compiledStart) {
      compiledStart.state_prompt = `${template.disclosure_line}\n\n${compiledStart.state_prompt}`;
    }
  }

  return {
    general_prompt: (template.system_prompt ?? "") + END_CALL_INSTRUCTION,
    starting_state: startState?.id ?? "",
    states: [...statesByName.values()],
    general_tools: [
      {
        type: "end_call",
        name: "end_call",
        description: "End the call once it's fully wrapped up.",
      },
    ],
  };
}

// ---------------------------------------------------------------------
// single_prompt
// ---------------------------------------------------------------------

export interface SinglePromptBody {
  general_prompt: string;
  /** CALL-7: see `MultiPromptBody#general_tools`'s own doc comment — the
   * SAME "a Retell LLM response engine never ends a call on its own"
   * platform-wide gap applies equally to `single_prompt` (`generic`'s own
   * compile target) since it's the identical `create-retell-llm` resource,
   * just without `states` — always includes the `end_call` entry alongside
   * every authored custom-function tool. */
  general_tools: (FunctionTool | EndCallTool | MultiPromptTransferCallTool)[];
}

function compileSinglePrompt(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
  options: CompileConversationFlowOptions = {},
): SinglePromptBody {
  const transferNumber = options.transferNumber?.trim() || null;
  // CALL-7: the SAME native-transfer-tool fix as `compileMultiPrompt` above
  // (see that function's own doc comment for the live-confirmed bug this
  // closes) — single_prompt has no per-state tool gating at all (every
  // granted tool is always available, by this compile target's own design,
  // this file's header), so there's no one state to special-case: exclude
  // `transfer_call` from the ordinary custom-webhook tools list entirely,
  // and either grant the native tool (transferNumber configured) or add an
  // honest "no live transfer" instruction section (not configured) instead.
  const transferToolDescription = template.tools.find(
    (t) => t.name === TRANSFER_CALL_TOOL_NAME,
  )?.description;
  const generalTools = toolsFor(template, toolWebhookUrl).filter(
    (t) => t.name !== TRANSFER_CALL_TOOL_NAME,
  );
  const hasTransferCallTool = template.tools.some((t) => t.name === TRANSFER_CALL_TOOL_NAME);

  const sections: string[] = [template.disclosure_line];
  if (template.system_prompt) sections.push(template.system_prompt);
  for (const state of template.states) {
    sections.push(`## ${state.name}\n${state.prompt_fragment}`);
  }
  for (const globalIntent of template.global_intents) {
    const targetFragment =
      template.states.find((s) => s.id === globalIntent.target_state)?.prompt_fragment ??
      globalIntent.target_state;
    sections.push(
      `## Escape: ${globalIntent.name}\nIf ${globalIntent.description}, immediately: ${targetFragment}`,
    );
  }
  if (hasTransferCallTool && !transferNumber) {
    sections.push(
      `## Transferring to a human\n${NO_TRANSFER_FALLBACK_INSTRUCTION}${NO_TRANSFER_FALLBACK_END_CALL_SUFFIX}`,
    );
  }
  sections.push(`## Ending the call\n${END_CALL_INSTRUCTION.trim()}`);

  return {
    general_prompt: sections.join("\n\n"),
    general_tools: [
      ...generalTools,
      {
        type: "end_call",
        name: "end_call",
        description: "End the call once it's fully wrapped up.",
      },
      ...(hasTransferCallTool && transferNumber
        ? [
            {
              type: "transfer_call" as const,
              name: TRANSFER_CALL_TOOL_NAME,
              description: transferToolDescription,
              transfer_destination: { type: "predefined" as const, number: transferNumber },
              transfer_option: { type: "warm_transfer" as const },
            },
          ]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------
// disclosure gate (G1/G2) + entry point
// ---------------------------------------------------------------------

export type CompiledFlowRequest =
  | { kind: "conversation_flow"; body: ConversationFlowBody }
  | { kind: "multi_prompt"; body: MultiPromptBody }
  | { kind: "single_prompt"; body: SinglePromptBody };

function firstTurnText(flow: CompiledFlowRequest): string {
  switch (flow.kind) {
    case "conversation_flow": {
      // The start node is always states[0] (compileConversationFlow), never
      // a synthetic `end`/`transfer_call`/wrap-up node — `instruction` is
      // only optional on those other union arms (declared there purely for
      // this lookup's type-checking, never populated by this compiler).
      const startNode = flow.body.nodes.find((n) => n.id === flow.body.start_node_id);
      return startNode?.instruction?.text ?? "";
    }
    case "multi_prompt": {
      const startState = flow.body.states.find((s) => s.name === flow.body.starting_state);
      return startState?.state_prompt ?? "";
    }
    case "single_prompt":
      return flow.body.general_prompt;
  }
}

/** The G1/G2 disclosure publish gate: refuses to consider a compile
 * "verified" unless `disclosure_line` appears verbatim in the first turn's
 * text. Pure and non-throwing (matches T2's `verifyDisclosureGate`) — the
 * HARD refusal to call Retell lives at the caller (admin/handler.ts), which
 * must check `disclosureVerified` before ever invoking a provider. */
export function verifyDisclosureGate(flow: CompiledFlowRequest, disclosureLine: string): boolean {
  if (disclosureLine.length === 0) return false;
  return firstTurnText(flow).includes(disclosureLine);
}

export interface CompiledTemplate {
  compileTarget: CompilerAgentTemplate["compile_target"];
  disclosureVerified: boolean;
  flow: CompiledFlowRequest;
}

export function compileTemplate(
  template: CompilerAgentTemplate,
  toolWebhookUrl: string,
  options: CompileConversationFlowOptions = {},
): CompiledTemplate {
  const flow: CompiledFlowRequest =
    template.compile_target === "conversation_flow"
      ? {
          kind: "conversation_flow",
          body: compileConversationFlow(template, toolWebhookUrl, options),
        }
      : template.compile_target === "multi_prompt"
        ? { kind: "multi_prompt", body: compileMultiPrompt(template, toolWebhookUrl, options) }
        : { kind: "single_prompt", body: compileSinglePrompt(template, toolWebhookUrl, options) };

  return {
    compileTarget: template.compile_target,
    disclosureVerified: verifyDisclosureGate(flow, template.disclosure_line),
    flow,
  };
}
