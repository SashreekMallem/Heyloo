/**
 * Lowers a canonical `AgentTemplate` (compile_target `multi_prompt`) into a
 * Retell LLM "states" request body (SYSTEM_DESIGN §4.1: legal — "hard-gated
 * conflict-check + no-advice guardrail per state, with open empathetic
 * discovery a rigid graph would flatten").
 *
 * Conventions (mirrors conversation-flow.ts where the concepts overlap,
 * VERIFY-8 compiler/types.ts):
 * - Each `AgentState` becomes one Retell "state", keyed by our `StateId`
 *   slug (not the human `name` label) to guarantee uniqueness.
 * - The FIRST declared state is `starting_state`; `disclosure_line` is
 *   prepended verbatim to ITS `state_prompt` (not `general_prompt` — the
 *   disclosure gate checks the starting state specifically, since
 *   `general_prompt` is shared ambient context, not the first spoken turn).
 * - `global_intents` add an edge from every reachable state to the target
 *   state (Retell LLM states have no separate global-node primitive the
 *   way Conversation Flow does — an edge from every applicable state is the
 *   structural equivalent: the escape is reachable, not model-discretionary).
 * - The one reserved `transfer_call` tool (`packages/templates/src/shared/
 *   tools.ts`) compiles to Retell LLM's native `TransferCallTool`
 *   (GAP_REGISTER §1.4 item 4 — "not a custom webhook"), not a custom
 *   function — RETELL-VERIFY, confirmed via retell-sdk's
 *   `LlmCreateParams.State.TransferCallTool`. Every other declared tool
 *   compiles as before.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import type {
  RetellFunctionTool,
  RetellMultiPromptRequest,
  RetellMultiPromptState,
  RetellStateTool,
  RetellTransferCallTool,
} from "./types.js";

const TRANSFER_CALL_TOOL_NAME = "transfer_call";
const TAKE_MESSAGE_TOOL_NAME = "take_message";

/** CALL-7: see `RetellEndCallTool`'s own doc comment (types.ts) — makes the
 * general_tools end_call tool actually get used; granting the tool alone
 * doesn't tell the model WHEN to call it. Appended to every multi_prompt
 * template's own `system_prompt`, independent of any per-vertical authored
 * content. */
const END_CALL_INSTRUCTION =
  "\n\nWhen the caller's request has been fully handled and they have nothing further to " +
  "discuss (they say goodbye, thank you, that's all, or similar, or you have already clearly " +
  "wrapped up the call), say a warm goodbye and then call the end_call tool to hang up. Never " +
  "just stop responding or repeat the same goodbye more than once — always end the call with " +
  "this tool once you've said goodbye.\n\n" +
  // CALL-8 (docs/BUILD_PLAN.md): mirrors the Deno compiler's identical fix
  // (`supabase/functions/_shared/compiler/template-compiler.ts`) — see that
  // file's own comment for the live-observed bug this closes.
  "Before you say goodbye or call end_call: if this call was ABOUT booking an appointment, " +
  "placing an order, or leaving a message/intake for the business to follow up on, you must " +
  "have ALREADY called the tool that actually records that (create_booking, create_order, or " +
  "take_message) earlier in this same call — never promise to record something, or act as if " +
  "you have, without having actually called that tool. If you realize you have not yet called " +
  "it, call it now (even with an incomplete set of fields — something recorded is always better " +
  "than nothing) before ending the call. This never applies to a call that was ONLY an FAQ " +
  "question, a transfer, or a cancellation with nothing new to record.";

function nativeTransferCallTool(description: string): RetellTransferCallTool {
  return {
    type: "transfer_call",
    name: TRANSFER_CALL_TOOL_NAME,
    description,
    transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
    // Warm transfer — SYSTEM_DESIGN §4.5: "warm transfers always carry a context summary".
    transfer_option: { type: "warm_transfer" },
  };
}

export function compileMultiPrompt(
  template: AgentTemplate,
  toolWebhookUrl: string,
): RetellMultiPromptRequest {
  const tools: RetellStateTool[] = template.tools.map((tool) => {
    if (tool.name === TRANSFER_CALL_TOOL_NAME) {
      return nativeTransferCallTool(tool.description);
    }
    const functionTool: RetellFunctionTool = {
      type: "custom",
      name: tool.name,
      description: tool.description,
      url: toolWebhookUrl,
      // `properties` is REQUIRED per retell-typescript-sdk's `CustomTool.
      // Parameters` — default an omitted one to `{}` (RETELL-VERIFY).
      parameters: {
        type: "object",
        properties: tool.parameters.properties ?? {},
        ...(tool.parameters.required !== undefined ? { required: tool.parameters.required } : {}),
      },
    };
    return functionTool;
  });
  // CALL-8 (docs/BUILD_PLAN.md): mirrors the Deno compiler's identical fix
  // (`supabase/functions/_shared/compiler/template-compiler.ts`) — see that
  // file's own comment for the live-observed bug this closes. take_message
  // moves to `general_tools` (structurally callable from EVERY state)
  // instead of only whichever per-state `allowed_tools` list it.
  const takeMessageTool = tools.find((t) => t.name === TAKE_MESSAGE_TOOL_NAME);
  const toolsByName = new Map(
    tools.filter((t) => t.name !== TAKE_MESSAGE_TOOL_NAME).map((t) => [t.name, t]),
  );

  const statesByName = new Map<string, RetellMultiPromptState>();
  for (const state of template.states) {
    statesByName.set(state.id, {
      name: state.id,
      state_prompt: state.prompt_fragment,
      edges: [],
      tools: state.allowed_tools
        .map((t) => toolsByName.get(t))
        .filter((t): t is RetellStateTool => t !== undefined),
    });
  }

  for (const transition of template.transitions) {
    const fromState = statesByName.get(transition.from);
    if (!fromState) continue;
    // CALL-7 (docs/BUILD_NOTES.md): mirrors the live Deno compiler's fix
    // (`supabase/functions/_shared/compiler/template-compiler.ts#
    // compileMultiPrompt`) for a real, live-confirmed Retell rejection —
    // `create-retell-llm` 400s with "Destination states must be unique
    // for a particular state, found duplicate destination state: <id>"
    // when one state has two edges to the same destination. Guarded here
    // too in case two authored transitions ever share a from/to pair.
    if (fromState.edges.some((e) => e.destination_state_name === transition.to)) continue;
    fromState.edges.push({
      destination_state_name: transition.to,
      description: transition.on.intent ?? transition.on.predicate ?? "",
    });
  }

  for (const globalIntent of template.global_intents) {
    const targetExists = statesByName.has(globalIntent.target_state);
    if (!targetExists) continue;
    const sourceStateIds =
      globalIntent.reachable_from === "any"
        ? [...statesByName.keys()]
        : globalIntent.reachable_from;
    for (const sourceId of sourceStateIds) {
      if (sourceId === globalIntent.target_state) continue;
      const sourceState = statesByName.get(sourceId);
      if (!sourceState) continue;
      // CALL-7: the actual bug this session hit live, via the Deno
      // compiler — a `reachable_from: "any"` global intent (e.g. legal's
      // "give_up" -> take_message_fallback) blindly added a SECOND edge
      // to a state that already had an authored `transitions` edge to
      // that exact same target. The first edge to claim a destination
      // wins (authored transitions run first, above); every additional
      // edge to an already-covered destination is dropped.
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
    const compiledStartState = statesByName.get(startState.id);
    if (compiledStartState) {
      compiledStartState.state_prompt = `${template.disclosure_line}\n\n${compiledStartState.state_prompt}`;
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
      ...(takeMessageTool ? [takeMessageTool] : []),
    ],
  };
}
