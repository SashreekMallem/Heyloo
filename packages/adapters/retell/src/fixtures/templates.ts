/**
 * Sample canonical `AgentTemplate` fixtures — one per compile_target, per
 * SYSTEM_DESIGN §4.1's vertical -> engine mapping — used by the compiler's
 * golden-file snapshot tests (compiler/*.test.ts) and available for reuse
 * by other packages' tests later (T6 templates).
 */

import type { AgentTemplate } from "@heyloo/canonical-types";

const DISCLOSURE_LINE =
  "Thanks for calling Joe's Auto Repair, this is their AI assistant — this call may be recorded.";

/** Auto vertical -> conversation_flow (SYSTEM_DESIGN §4.1: "hard slot-filling; tool-backed nodes only"). */
export const AUTO_CONVERSATION_FLOW_TEMPLATE: AgentTemplate = {
  vertical: "auto",
  compile_target: "conversation_flow",
  system_prompt: "You are the friendly front-desk assistant for an auto repair shop.",
  states: [
    {
      id: "greeting",
      name: "Greeting",
      prompt_fragment: "Greet the caller and ask how you can help today.",
      allowed_tools: [],
    },
    {
      id: "collect_vehicle",
      name: "Collect vehicle info",
      prompt_fragment: "Ask for the vehicle's year, make, and model.",
      allowed_tools: [],
    },
    {
      id: "check_time",
      name: "Check availability",
      prompt_fragment: "Ask what day/time works, then check availability.",
      allowed_tools: ["check_availability"],
    },
    {
      id: "confirm_booking",
      name: "Confirm booking",
      prompt_fragment: "Confirm the details and create the booking.",
      allowed_tools: ["create_booking"],
      is_terminal: true,
    },
    {
      id: "triage_emergency",
      name: "Emergency triage",
      prompt_fragment: "The caller has an urgent safety issue — offer a tow partner referral.",
      allowed_tools: ["take_message"],
      is_terminal: true,
    },
  ],
  transitions: [
    { from: "greeting", to: "collect_vehicle", on: { intent: "wants_to_book_service" } },
    { from: "collect_vehicle", to: "check_time", on: { intent: "vehicle_info_collected" } },
    { from: "check_time", to: "confirm_booking", on: { predicate: "slot_selected" } },
  ],
  global_intents: [
    {
      name: "emergency",
      reachable_from: "any",
      target_state: "triage_emergency",
      description: "Caller mentions brakes failing, smoke, or another immediate safety issue.",
    },
  ],
  tools: [
    {
      name: "check_availability",
      description: "Check open service bay slots.",
      parameters: {
        type: "object",
        properties: { date_range: { type: "object" } },
        required: ["date_range"],
      },
      authorization: { scope: "none" },
    },
    {
      name: "create_booking",
      description: "Create a service booking.",
      parameters: {
        type: "object",
        properties: { resource_id: { type: "string" } },
        required: ["resource_id"],
      },
      authorization: { scope: "none" },
    },
    {
      name: "take_message",
      description: "Record a message for the shop to follow up.",
      parameters: {
        type: "object",
        properties: { message_text: { type: "string" } },
        required: ["message_text"],
      },
      authorization: { scope: "none" },
    },
  ],
  disclosure_line: DISCLOSURE_LINE,
};

/** Legal vertical -> multi_prompt (SYSTEM_DESIGN §4.1: "hard-gated conflict-check + no-advice guardrail per state"). */
export const LEGAL_MULTI_PROMPT_TEMPLATE: AgentTemplate = {
  vertical: "legal",
  compile_target: "multi_prompt",
  system_prompt:
    "You are an intake assistant for a law firm. NEVER give legal advice or a merits opinion, at any state.",
  states: [
    {
      id: "greeting",
      name: "Greeting",
      prompt_fragment: "Greet the caller and ask what brings them in today.",
      allowed_tools: [],
    },
    {
      id: "matter_type",
      name: "Matter type",
      prompt_fragment: "Ask what type of legal matter this is.",
      allowed_tools: [],
    },
    {
      id: "conflict_check",
      name: "Conflict check",
      prompt_fragment:
        "Ask for the opposing party's full name BEFORE any substantive discussion — flag for human review, never auto-clear.",
      allowed_tools: ["take_message"],
      is_terminal: true,
    },
  ],
  transitions: [
    { from: "greeting", to: "matter_type", on: { intent: "explains_reason_for_calling" } },
    { from: "matter_type", to: "conflict_check", on: { intent: "matter_type_identified" } },
  ],
  global_intents: [
    {
      name: "human_request",
      reachable_from: "any",
      target_state: "conflict_check",
      description: "Caller explicitly asks to speak with an attorney or a human.",
    },
  ],
  tools: [
    {
      name: "take_message",
      description: "Record intake details for attorney follow-up.",
      parameters: {
        type: "object",
        properties: { message_text: { type: "string" } },
        required: ["message_text"],
      },
      authorization: { scope: "none" },
    },
  ],
  disclosure_line:
    "Thanks for calling Smith & Associates, this is their AI assistant — this call may be recorded.",
};

/** Real estate vertical -> single_prompt (SYSTEM_DESIGN §4.1: "qualification is conversational"). */
export const REAL_ESTATE_SINGLE_PROMPT_TEMPLATE: AgentTemplate = {
  vertical: "real_estate",
  compile_target: "single_prompt",
  system_prompt:
    "You are a friendly assistant for a real estate agency. Qualify buyers/sellers conversationally in about 2 minutes.",
  states: [],
  transitions: [],
  global_intents: [],
  tools: [
    {
      name: "take_message",
      description: "Record contact info and callback preference.",
      parameters: {
        type: "object",
        properties: { message_text: { type: "string" } },
        required: ["message_text"],
      },
      authorization: { scope: "none" },
    },
  ],
  disclosure_line:
    "Thanks for calling Riverside Realty, this is their AI assistant — this call may be recorded.",
};
