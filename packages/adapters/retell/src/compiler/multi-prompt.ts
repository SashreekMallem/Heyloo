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
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import type {
  RetellFunctionTool,
  RetellMultiPromptRequest,
  RetellMultiPromptState,
} from "./types.js";

export function compileMultiPrompt(
  template: AgentTemplate,
  toolWebhookUrl: string,
): RetellMultiPromptRequest {
  const tools: RetellFunctionTool[] = template.tools.map((tool) => ({
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
  }));
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const statesByName = new Map<string, RetellMultiPromptState>();
  for (const state of template.states) {
    statesByName.set(state.id, {
      name: state.id,
      state_prompt: state.prompt_fragment,
      edges: [],
      tools: state.allowed_tools
        .map((t) => toolsByName.get(t))
        .filter((t): t is RetellFunctionTool => t !== undefined),
    });
  }

  for (const transition of template.transitions) {
    const fromState = statesByName.get(transition.from);
    if (!fromState) continue;
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
    general_prompt: template.system_prompt ?? "",
    starting_state: startState?.id ?? "",
    states: [...statesByName.values()],
  };
}
