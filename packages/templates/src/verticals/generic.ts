/**
 * Generic — SYSTEM_DESIGN §4.1 (single_prompt) + §4.3 input-collection
 * spec: "name · phone · reason · message · callback window." The fallback
 * vertical for any business that doesn't fit the other 7 (`@heyloo/
 * canonical-types` `vertical.ts`); still gets real booking-write + SMS
 * (SYSTEM_DESIGN §1 "Generic-tier defense vs the $49-99 floor" — real
 * competitors at that price point gate booking behind a higher plan).
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
  sendSmsConfirmationTool,
  takeMessageTool,
  transferCallTool,
} from "../shared/tools.js";
import {
  safetyEmergencyState,
  solicitorDeflectState,
  transferToHumanState,
} from "../shared/utility-states.js";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the phone assistant for this business. Find out why the caller is calling, help " +
    "them book an appointment if the business takes them, or take a clear message for a " +
    "callback otherwise.",
  CONSENT_ASK_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
);

export const GENERIC_TEMPLATE: AgentTemplate = {
  vertical: "generic",
  compile_target: "single_prompt",
  system_prompt: SYSTEM_PROMPT,
  states: [
    {
      id: "intake",
      name: "Intake",
      prompt_fragment:
        "Collect, one at a time: the caller's name · their phone number · the reason for the " +
        "call. If the business can book what they need, offer check_availability/" +
        "create_booking. Otherwise take a message with a clear callback window and let them " +
        "know when to expect a call back.",
      allowed_tools: [
        "check_availability",
        "create_booking",
        "lookup_customer",
        "take_message",
        "send_sms_confirmation",
      ],
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
      "Book an appointment once name, phone, reason, and a confirmed open time are collected, " +
        "after asking the consent question.",
    ),
    lookupCustomerTool(),
    takeMessageTool(),
    sendSmsConfirmationTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
