/**
 * Real estate — SYSTEM_DESIGN §4.1 (single_prompt: "qualification is
 * conversational; over-structuring reads as interrogation; under the
 * ~1000-word/5-tool threshold") + §4.3 input-collection spec: "buyer/
 * seller · property or area · pre-approved? · timeline · budget · showing
 * time — covered in ~2 minutes, conversational."
 *
 * No rigid state graph: `states[]` here are organizational sections the
 * single-prompt compiler folds into the one prompt (compiler/single-
 * prompt.ts), plus the three shared escape states every template needs as
 * `global_intents` targets.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import { DISCLOSURE_LINE } from "../shared/disclosure.js";
import { CONSENT_ASK_FRAGMENT, WAITLIST_OFFER_FRAGMENT } from "../shared/fragments.js";
import {
  humanRequestGlobalIntent,
  safetyEmergencyGlobalIntent,
  solicitorGlobalIntent,
} from "../shared/global-intents.js";
import { buildSystemPrompt } from "../shared/system-prompt.js";
import {
  checkAvailabilityTool,
  createBookingTool,
  lookupCustomerTool,
  takeMessageTool,
  transferCallTool,
} from "../shared/tools.js";
import {
  safetyEmergencyState,
  solicitorDeflectState,
  transferToHumanState,
} from "../shared/utility-states.js";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are a friendly assistant for a real estate agency. Qualify buyers and sellers " +
    "conversationally, covering the ground below in about 2 minutes — this is a natural " +
    "conversation, not an interrogation, so it's fine to let the caller lead and cover things " +
    "out of order as long as you get to all of it before scheduling a showing.",
  CONSENT_ASK_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
);

export const REAL_ESTATE_TEMPLATE: AgentTemplate = {
  vertical: "real_estate",
  compile_target: "single_prompt",
  system_prompt: SYSTEM_PROMPT,
  states: [
    {
      id: "qualification",
      name: "Qualification",
      prompt_fragment:
        "Cover, conversationally: whether they're a buyer or a seller · the property or area " +
        "they're interested in · whether a buyer is pre-approved for financing · their " +
        "timeline · their budget · and, once the above is clear, offer to schedule a showing " +
        "with check_availability/create_booking. If they just want a quote/valuation with no " +
        "commitment yet, that's fine — capture their contact info with take_message so an " +
        "agent can follow up; don't force a showing booking.",
      allowed_tools: ["check_availability", "create_booking", "lookup_customer", "take_message"],
    },
    transferToHumanState(),
    solicitorDeflectState(),
    safetyEmergencyState(),
  ],
  transitions: [],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [
    checkAvailabilityTool(),
    createBookingTool(
      "Schedule a property showing once area, timeline, and a confirmed open time are agreed, " +
        "after asking the consent question.",
    ),
    lookupCustomerTool(),
    takeMessageTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
