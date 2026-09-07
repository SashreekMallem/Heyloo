/**
 * Legal intake — SYSTEM_DESIGN §4.1 (multi_prompt: "hard-gated conflict-
 * check + no-advice guardrail per state, with open empathetic discovery a
 * rigid graph would flatten") + §4.3 input-collection spec: "name+phone ·
 * matter type · open discovery ('walk me through it') · urgency (SOL,
 * custody, court date) · opposing party full name BEFORE substantive
 * discussion (conflict check — flagged for human review, never
 * auto-cleared) · referral source." Hard guardrail: no legal advice, no
 * merits opinion, no fee quotes beyond the configured consult fee;
 * `legal_advice_given` must always be false — every state below carries
 * BOTH the guardrail text and the extraction field (via `withLegalGuardrail`
 * below), never left to chance on any one state.
 */

import type { AgentState, AgentTemplate } from "@heyloo/canonical-types";
import { DISCLOSURE_LINE } from "../shared/disclosure.js";
import {
  humanRequestGlobalIntent,
  safetyEmergencyGlobalIntent,
  solicitorGlobalIntent,
} from "../shared/global-intents.js";
import { buildSystemPrompt } from "../shared/system-prompt.js";
import { lookupCustomerTool, takeMessageTool, transferCallTool } from "../shared/tools.js";
import {
  safetyEmergencyState,
  solicitorDeflectState,
  transferToHumanState,
} from "../shared/utility-states.js";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are an intake assistant for a law firm. Your job is to gather intake information " +
    "warmly and thoroughly so an attorney can follow up — not to practice law yourself. " +
    "This firm handles {{practice_areas}}; if a caller's matter is outside that list, say so " +
    "honestly and still offer to take a message.",
);

const NO_ADVICE_GUARDRAIL =
  "Hard guardrail — true in this state and every other state in this call, with no " +
  "exceptions: never give legal advice, never offer an opinion on the merits or likely " +
  "outcome of the caller's case, and never quote a fee beyond the configured consult fee " +
  "({{consult_fee_text}}). If pressed, say only that an attorney will review the details and " +
  "follow up — never improvise around this rule.";

/**
 * Applied to EVERY state in this template (including the shared transfer/
 * solicitor/emergency ones) so the guardrail and its `legal_advice_given`
 * extraction field are structurally present everywhere, not just on the
 * states authored specifically for this vertical.
 */
function withLegalGuardrail(state: AgentState): AgentState {
  return {
    ...state,
    prompt_fragment: `${state.prompt_fragment}\n\n${NO_ADVICE_GUARDRAIL}`,
    extraction: [...(state.extraction ?? []), { field: "legal_advice_given", type: "boolean" }],
  };
}

const rawStates: AgentState[] = [
  {
    id: "greeting",
    name: "Greeting",
    prompt_fragment: "Greet the caller and ask what brings them in today.",
    allowed_tools: [],
  },
  {
    id: "collect_name_phone",
    name: "Collect name + phone",
    prompt_fragment: "Ask for the caller's full name, then their phone number, confirming each.",
    allowed_tools: [],
  },
  {
    id: "matter_type",
    name: "Matter type",
    prompt_fragment:
      "Ask what type of legal matter this is, guiding toward one of {{practice_areas}} if it " +
      "fits.",
    allowed_tools: [],
  },
  {
    id: "conflict_check",
    name: "Conflict check (BEFORE any substantive discussion)",
    prompt_fragment:
      "Before discussing any details of the matter itself, ask for the opposing party's full " +
      "name (and their attorney's name/firm, if the caller knows it) — this happens BEFORE the " +
      "open-discovery conversation, every time, no exceptions. This is a conflict-of-interest " +
      "check: record what the caller says and let them know the firm will confirm there's no " +
      "conflict before anything proceeds. Never tell the caller a conflict check has 'passed' " +
      "or 'cleared' — that determination is always made by a human at the firm, never by you.",
    allowed_tools: [],
  },
  {
    id: "open_discovery",
    name: "Open discovery",
    prompt_fragment:
      'Now invite the caller to explain, in their own words: "Walk me through what happened." ' +
      "Listen and ask open, empathetic follow-up questions without steering them or evaluating " +
      "what they say.",
    allowed_tools: [],
  },
  {
    id: "urgency",
    name: "Urgency check",
    prompt_fragment:
      "Ask about anything time-sensitive: a statute-of-limitations concern, a custody " +
      "situation, or an upcoming court date. Flag anything urgent for the attorney clearly in " +
      "the message.",
    allowed_tools: [],
  },
  {
    id: "referral_source",
    name: "Referral source",
    prompt_fragment: "Ask how the caller heard about this firm.",
    allowed_tools: [],
  },
  {
    id: "intake_complete",
    name: "Intake complete",
    prompt_fragment:
      "Thank the caller, let them know an attorney will review the intake (including the " +
      "conflict check) and follow up, and record the full intake as a message for the firm.",
    allowed_tools: ["take_message"],
    is_terminal: true,
  },
  transferToHumanState(),
  solicitorDeflectState(),
  safetyEmergencyState(),
];

export const LEGAL_TEMPLATE: AgentTemplate = {
  vertical: "legal",
  compile_target: "multi_prompt",
  system_prompt: SYSTEM_PROMPT,
  states: rawStates.map(withLegalGuardrail),
  transitions: [
    { from: "greeting", to: "collect_name_phone", on: { intent: "explains_reason_for_calling" } },
    { from: "collect_name_phone", to: "matter_type", on: { intent: "name_phone_confirmed" } },
    { from: "matter_type", to: "conflict_check", on: { intent: "matter_type_identified" } },
    {
      from: "conflict_check",
      to: "open_discovery",
      on: { intent: "opposing_party_recorded" },
    },
    { from: "open_discovery", to: "urgency", on: { intent: "discovery_complete" } },
    { from: "urgency", to: "referral_source", on: { intent: "urgency_recorded" } },
    { from: "referral_source", to: "intake_complete", on: { intent: "referral_source_recorded" } },
  ],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [lookupCustomerTool(), takeMessageTool(), transferCallTool()],
  disclosure_line: DISCLOSURE_LINE,
};
