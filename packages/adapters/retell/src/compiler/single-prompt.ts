/**
 * Lowers a canonical `AgentTemplate` (compile_target `single_prompt`) into a
 * single Retell LLM mega-prompt request body (SYSTEM_DESIGN §4.1: real
 * estate, generic — "qualification is conversational; over-structuring
 * reads as interrogation; under the ~1000-word/5-tool threshold").
 *
 * There is no graph here. DISCLOSE-1 (docs/BUILD_NOTES.md): `disclosure_line`
 * is spoken verbatim as the static `begin_message` (`opening.ts`), and
 * `general_prompt` opens by saying it was already spoken; `system_prompt` (required by the
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
import {
  buildOpeningLine,
  COMPILER_DEFAULT_DYNAMIC_VARIABLES,
  NEVER_ANNOUNCE_WITHOUT_TRANSFER_INSTRUCTION,
  openingAlreadySpokenInstruction,
  TRANSFER_ANNOUNCEMENT_INSTRUCTION,
} from "./opening.js";
import { OWNER_INFO_INSTRUCTIONS } from "./owner-info.js";
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
        // DISCLOSE-1 (mirrors template-compiler.ts): the tool announces the
        // connection itself, only while it actually transfers.
        speak_during_execution: true,
        execution_message_type: "prompt",
        execution_message_description: TRANSFER_ANNOUNCEMENT_INSTRUCTION,
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

  // DISCLOSE-1 (docs/BUILD_NOTES.md, mirrors template-compiler.ts): the
  // disclosure is the static `begin_message` now; the prompt only needs to
  // know it was already spoken.
  const opening = buildOpeningLine(template.disclosure_line);
  // SETTINGS-2: the owner-info block (parity with the Deno compiler's global call-context).
  const sections: string[] = [openingAlreadySpokenInstruction(opening), OWNER_INFO_INSTRUCTIONS];
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
  if (template.tools.some((t) => t.name === TRANSFER_CALL_TOOL_NAME)) {
    sections.push(`## Transferring to a human\n${NEVER_ANNOUNCE_WITHOUT_TRANSFER_INSTRUCTION}`);
  }
  // CALL-7: see `RetellEndCallTool`'s own doc comment (types.ts) — the same
  // "a Retell LLM response engine never ends a call on its own" gap applies
  // equally here (identical create-retell-llm resource, just without
  // `states`).
  sections.push(
    "## Ending the call\nWhen the caller's request has been fully handled and they have " +
      "nothing further to discuss (they say goodbye, thank you, that's all, or similar, or " +
      "you have already clearly wrapped up the call), say a warm goodbye and then call the " +
      "end_call tool to hang up. Never just stop responding or repeat the same goodbye more " +
      "than once — always end the call with this tool once you've said goodbye.\n\n" +
      // CALL-8 (docs/BUILD_PLAN.md): mirrors the Deno compiler's identical
      // fix (`supabase/functions/_shared/compiler/template-compiler.ts`) —
      // see that file's own comment for the live-observed bug this closes.
      "Before you say goodbye or call end_call: if this call was ABOUT booking an appointment, " +
      "placing an order, or leaving a message/intake for the business to follow up on, you " +
      "must have ALREADY called the tool that actually records that (create_booking, " +
      "create_order, or take_message) earlier in this same call — never promise to record " +
      "something, or act as if you have, without having actually called that tool. If you " +
      "realize you have not yet called it, call it now (even with an incomplete set of fields " +
      "— something recorded is always better than nothing) before ending the call. This never " +
      "applies to a call that was ONLY an FAQ question, a transfer, or a cancellation with " +
      "nothing new to record.",
  );

  return {
    begin_message: opening.text,
    start_speaker: "agent",
    default_dynamic_variables: { ...COMPILER_DEFAULT_DYNAMIC_VARIABLES },
    general_prompt: sections.join("\n\n"),
    general_tools: [
      ...generalTools,
      {
        type: "end_call",
        name: "end_call",
        description: "End the call once it's fully wrapped up.",
      },
    ],
  };
}
