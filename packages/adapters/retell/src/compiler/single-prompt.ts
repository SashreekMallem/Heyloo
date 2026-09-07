/**
 * Lowers a canonical `AgentTemplate` (compile_target `single_prompt`) into a
 * single Retell LLM mega-prompt request body (SYSTEM_DESIGN §4.1: real
 * estate, generic — "qualification is conversational; over-structuring
 * reads as interrogation; under the ~1000-word/5-tool threshold").
 *
 * There is no graph here: `disclosure_line` is prepended verbatim as the
 * very first line of `general_prompt` (the first agent turn, by
 * definition, for a single-prompt agent); `system_prompt` (required by the
 * canonical schema for this target) follows; any declared `states[]` are
 * folded in as labeled guidance sections (single_prompt templates are not
 * REQUIRED to have zero states — a template author may still use them as
 * organizational scaffolding even though there's no graph to traverse);
 * `global_intents` become explicit textual escape instructions, since a
 * single prompt has no separate node/state to route to structurally.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import type { RetellFunctionTool, RetellSinglePromptRequest } from "./types.js";

export function compileSinglePrompt(
  template: AgentTemplate,
  toolWebhookUrl: string,
): RetellSinglePromptRequest {
  const generalTools: RetellFunctionTool[] = template.tools.map((tool) => ({
    type: "custom",
    name: tool.name,
    description: tool.description,
    url: toolWebhookUrl,
    parameters: tool.parameters,
  }));

  const sections: string[] = [template.disclosure_line];
  if (template.system_prompt) {
    sections.push(template.system_prompt);
  }
  for (const state of template.states) {
    sections.push(`## ${state.name}\n${state.prompt_fragment}`);
  }
  for (const globalIntent of template.global_intents) {
    sections.push(
      `## Escape: ${globalIntent.name}\nIf ${globalIntent.description}, immediately: ${
        template.states.find((s) => s.id === globalIntent.target_state)?.prompt_fragment ??
        globalIntent.target_state
      }`,
    );
  }

  return {
    general_prompt: sections.join("\n\n"),
    general_tools: generalTools,
  };
}
