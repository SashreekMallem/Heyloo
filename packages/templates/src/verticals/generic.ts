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
import { withCallOutcomeExtraction } from "../shared/extraction.js";
import {
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
} from "../shared/fragments.js";
import {
  humanRequestGlobalIntent,
  safetyEmergencyGlobalIntent,
  solicitorGlobalIntent,
} from "../shared/global-intents.js";
import { buildSystemPrompt } from "../shared/system-prompt.js";
import {
  cancelBookingTool,
  checkAvailabilityTool,
  createBookingTool,
  joinWaitlistTool,
  lookupCustomerTool,
  sendSmsConfirmationTool,
  takeMessageTool,
  transferCallTool,
  updateBookingTool,
} from "../shared/tools.js";
import {
  manageBookingState,
  safetyEmergencyState,
  solicitorDeflectState,
  transferToHumanState,
} from "../shared/utility-states.js";

/**
 * GAP_REGISTER.md §2 Generic item 3 (BLOCKER — "the one booking-capable
 * vertical missing both" a reschedule/cancel path and a cancellation-policy
 * readout, §1.12). Adding `manageBookingState()` + `updateBookingTool()`/
 * `cancelBookingTool()` (the same building blocks every other booking
 * vertical uses) pushes this already-over-soft-budget single_prompt
 * template further over (previously measured at 969 words/6 tools, one
 * tool past the ~5-tool soft threshold — `packages/adapters/retell/src/
 * compiler/registry-consistency.test.ts`'s budget check, soft-warn only,
 * not a hard CI gate). Decision (logged per CLAUDE.md Rule 4 in
 * `docs/BUILD_NOTES.md`): KEEP `single_prompt` rather than bump generic to
 * a costlier compile tier — this is deliberately the cheap/floor-priced
 * vertical (SYSTEM_DESIGN §1 "$49-99 floor" positioning) and moving it to
 * `multi_prompt` (real_estate's fix for the identical tension, see that
 * file) would raise its per-call cost tier, a pricing decision this
 * cluster isn't positioned to make unilaterally. A caller genuinely being
 * unable to reschedule/cancel is a harder functional gap than a soft word-
 * budget overage, so the correctness fix ships now; the resulting overage
 * is flagged for a product/eng follow-up call, not silently absorbed.
 */
const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the phone assistant for this business. Find out why the caller is calling, help " +
    "them book an appointment if the business takes them, or take a clear message for a " +
    "callback otherwise.",
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
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
        "join_waitlist",
        "lookup_customer",
        "take_message",
        "send_sms_confirmation",
      ],
    },
    manageBookingState(),
    transferToHumanState(),
    solicitorDeflectState(),
    safetyEmergencyState(),
  ].map(withCallOutcomeExtraction),
  transitions: [],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
    {
      name: "manage_booking",
      reachable_from: "any",
      target_state: "manage_booking",
      description: "The caller wants to reschedule or cancel an existing appointment.",
    },
  ],
  tools: [
    checkAvailabilityTool(),
    createBookingTool(
      "Book an appointment once name, phone, reason, and a confirmed open time are collected, " +
        "after asking the consent question.",
      "generic",
    ),
    updateBookingTool(),
    cancelBookingTool(),
    joinWaitlistTool(),
    lookupCustomerTool(),
    takeMessageTool("generic"),
    sendSmsConfirmationTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
