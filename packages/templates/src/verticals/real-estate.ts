/**
 * Real estate — SYSTEM_DESIGN §4.1 (originally single_prompt: "qualification
 * is conversational; over-structuring reads as interrogation") + §4.3
 * input-collection spec: "buyer/seller · property or area · pre-approved? ·
 * timeline · budget · showing time — covered in ~2 minutes, conversational."
 *
 * COMPILE-TARGET DECISION (GAP_REGISTER.md §2 Real estate items 1/2/4/5,
 * §1.12's explicit "log the tradeoff in docs/BUILD_NOTES.md" instruction):
 * this template moved from `single_prompt` to `multi_prompt`. The audit
 * measured the old single_prompt version at 1,022 words / 5 tools — already
 * at/over Retell's documented single_prompt viability ceiling — BEFORE
 * adding the reschedule/cancel path, cancellation-policy readout, and
 * showing-confirmation SMS this pass closes as BLOCKERs; trimming existing
 * qualification prose to make room would have meant cutting the exact
 * buyer/seller/area/pre-approval/timeline/budget conversational coverage
 * the vertical exists to collect. `multi_prompt` (legal's compile target,
 * for the identical reason — SYSTEM_DESIGN §4.1: "open empathetic
 * discovery a rigid graph would flatten") solves both problems at once:
 * each state's `state_prompt` is shown only when active (no single
 * all-up-front prompt to blow a word budget) while `qualification` stays
 * ONE open, model-mediated state — not a rigid field-by-field
 * conversation_flow graph — so the "not an interrogation" design intent
 * this vertical was built around is preserved, not overridden. Full
 * decision logged in `docs/BUILD_NOTES.md` per CLAUDE.md Rule 4.
 *
 * NOT added (GAP_REGISTER.md §2 Real estate item 3): an explicit "already
 * working with another agent?" question. `zRealEstateBookingPayload`
 * (`@heyloo/canonical-types` `booking-payloads.ts`) already declares
 * `working_with_another_agent` as a typed field ready to receive it, but
 * the audit itself calls this "a spec-level gap, not just a template gap"
 * — it's a real industry compliance/norms question (agency-representation
 * disclosure rules vary by state) that SYSTEM_DESIGN §4.3 needs to decide
 * on, not something a template author should silently add wording for.
 * Flagged in `docs/BUILD_NOTES.md`, not answered here (CLAUDE.md Rule 4).
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
  giveUpGlobalIntent,
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
  takeMessageFallbackState,
  transferToHumanState,
} from "../shared/utility-states.js";

/**
 * GAP_REGISTER.md §1.7: same gap as legal's take_message — `take_message`
 * has no typed destination for buyer/seller/area/pre-approval/timeline/
 * budget the way `create_booking`'s `structured_payload`
 * (`zRealEstateBookingPayload`) now does, so a lead who ISN'T ready to book
 * a showing yet (the "just wants a quote/valuation" path) would otherwise
 * lose everything just qualified. Extending `take_message`'s schema is
 * outside this cluster's ownership — filed in `docs/audit/FIX_REQUESTS.md`
 * (same request as legal's). Until then, label the fields into
 * `message_text` so nothing is silently dropped.
 */
const STRUCTURED_LEAD_CAPTURE_FRAGMENT =
  "Whenever you call take_message for a lead who isn't booking a showing right now, compose " +
  'message_text as labeled lines so nothing qualified is lost: "Buyer or seller: ...", ' +
  '"Area/property: ...", "Pre-approved: yes/no/not asked", "Timeline: ...", "Budget: ...", ' +
  "then a short summary of what they're looking for.";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are a friendly assistant for a real estate agency. Qualify buyers and sellers " +
    "conversationally, covering the ground below in about 2 minutes — this is a natural " +
    "conversation, not an interrogation, so it's fine to let the caller lead and cover things " +
    "out of order as long as you get to all of it before scheduling a showing.",
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
  STRUCTURED_LEAD_CAPTURE_FRAGMENT,
);

export const REAL_ESTATE_TEMPLATE: AgentTemplate = {
  vertical: "real_estate",
  compile_target: "multi_prompt",
  system_prompt: SYSTEM_PROMPT,
  states: [
    {
      id: "greeting",
      name: "Greeting",
      prompt_fragment:
        "Greet the caller and ask how you can help — buying, selling, scheduling a showing on " +
        "a listing they've seen, changing an existing showing, or something else.",
      allowed_tools: [],
    },
    {
      id: "qualification",
      name: "Qualification",
      prompt_fragment:
        "Cover, conversationally, in any order the caller leads with: whether they're a buyer " +
        "or a seller · the property or area they're interested in · whether a buyer is " +
        "pre-approved for financing · their timeline · their budget. You may call " +
        "lookup_customer with the number they're calling from to check whether they're a " +
        "returning contact and skip re-asking anything already on file. Once the above is " +
        "clear: if they want to schedule a showing, move to that; if they just want a quote/" +
        "valuation with no commitment yet, take a message instead so an agent can follow up — " +
        "don't force a showing booking.",
      allowed_tools: ["lookup_customer"],
    },
    {
      id: "schedule_showing",
      name: "Schedule showing",
      prompt_fragment:
        "Call check_availability for the property/area and requested window. If none_available, " +
        "follow the waitlist-offer rule. Once a slot is chosen, read back area, timeline, and " +
        "the date/time, ask the consent question, state the cancellation policy, then create " +
        "the booking with structured_payload set to whatever you learned in qualification " +
        "(buyer_or_seller, area, pre_approved, timeline, budget_cents) and send the SMS " +
        "confirmation.",
      allowed_tools: [
        "check_availability",
        "create_booking",
        "join_waitlist",
        "send_sms_confirmation",
      ],
      is_terminal: true,
    },
    {
      id: "lead_only",
      name: "Lead capture (no showing yet)",
      prompt_fragment:
        "The caller wants a valuation/quote or just isn't ready to schedule a showing yet. " +
        "Take a message per the structured-lead-capture rule so an agent can follow up.",
      allowed_tools: ["take_message"],
      is_terminal: true,
    },
    manageBookingState(),
    transferToHumanState(),
    solicitorDeflectState(),
    safetyEmergencyState(),
    takeMessageFallbackState(),
  ].map(withCallOutcomeExtraction),
  transitions: [
    { from: "greeting", to: "qualification", on: { intent: "explains_reason_for_calling" } },
    { from: "greeting", to: "manage_booking", on: { intent: "wants_to_reschedule_or_cancel" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_wants_to_leave_a_message" },
    },
    { from: "qualification", to: "schedule_showing", on: { intent: "ready_to_schedule_showing" } },
    { from: "qualification", to: "lead_only", on: { intent: "not_ready_to_schedule_yet" } },
  ],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
    giveUpGlobalIntent("take_message_fallback"),
  ],
  tools: [
    checkAvailabilityTool(),
    createBookingTool(
      "Schedule a property showing once area, timeline, and a confirmed open time are agreed, " +
        "after asking the consent question.",
      "real_estate",
    ),
    updateBookingTool(),
    cancelBookingTool(),
    joinWaitlistTool(),
    lookupCustomerTool(),
    takeMessageTool("real_estate"),
    sendSmsConfirmationTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
