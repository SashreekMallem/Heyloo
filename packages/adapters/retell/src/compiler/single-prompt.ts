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
 *
 * The one reserved `transfer_call` tool compiles to Retell LLM's native
 * `TransferCallTool` (GAP_REGISTER §1.4 item 4), same as multi-prompt.ts.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import type {
  RetellFunctionTool,
  RetellSinglePromptRequest,
  RetellStateTool,
  RetellTransferCallTool,
} from "./types.js";

const TRANSFER_CALL_TOOL_NAME = "transfer_call";

export function compileSinglePrompt(
  template: AgentTemplate,
  toolWebhookUrl: string,
): RetellSinglePromptRequest {
  const generalTools: RetellStateTool[] = template.tools.map((tool) => {
    if (tool.name === TRANSFER_CALL_TOOL_NAME) {
      const transferTool: RetellTransferCallTool = {
        type: "transfer_call",
        name: TRANSFER_CALL_TOOL_NAME,
        description: tool.description,
        transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
        transfer_option: { type: "warm_transfer" },
      };
      return transferTool;
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
