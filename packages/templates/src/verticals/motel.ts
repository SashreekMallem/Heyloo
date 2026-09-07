/**
 * Motel — SYSTEM_DESIGN §4.1 (conversation_flow) + §4.3 input-collection
 * spec: "dates · guests · room type · rate only from the owner-configured
 * rate table via tool call · payment/cancel policy · no-availability →
 * offer nearest alternative." MASTER_SPEC §3.2: deposits are collected via
 * `send_payment_link`, with the booking held `scheduled` until paid.
 *
 * NOTE (rate source): the canonical tool set (`@heyloo/canonical-types`
 * `TOOL_NAMES`) has no dedicated "get_rate" tool — per SYSTEM_DESIGN §5
 * ("static context ... rides in dynamic variables at call start — zero
 * tool calls"), the owner-configured `rate_table` (MASTER_SPEC §3.5) is
 * injected as the `{{rate_table}}` dynamic variable rather than fetched
 * live. "Rate only from the tool/config, never invented" is therefore
 * enforced here as an explicit, structurally-reinforced prompt rule rather
 * than a distinct tool-call node — flagged in `docs/BUILD_NOTES.md` (T6)
 * as a follow-up worth a real `get_rate_table` tool if rate tables grow
 * large enough to outgrow a dynamic variable.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import { DISCLOSURE_LINE } from "../shared/disclosure.js";
import { CANCELLATION_POLICY_READOUT_FRAGMENT, CONSENT_ASK_FRAGMENT } from "../shared/fragments.js";
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
  lookupCustomerTool,
  sendPaymentLinkTool,
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

const RATE_DISCIPLINE_FRAGMENT =
  "The nightly rate for every room type is given to you in {{rate_table}} — that is the ONLY " +
  "source of truth for pricing. Never invent, estimate, or round a rate; if a room type isn't " +
  "in {{rate_table}}, say you'll need to check and take a message instead of guessing.";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the front-desk assistant for a motel. You book stays, quote rates strictly from " +
    "the configured rate table, state the deposit and cancellation policy, and take messages.",
  RATE_DISCIPLINE_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
);

export const MOTEL_TEMPLATE: AgentTemplate = {
  vertical: "motel",
  compile_target: "conversation_flow",
  system_prompt: SYSTEM_PROMPT,
  states: [
    {
      id: "greeting",
      name: "Greeting",
      prompt_fragment:
        "Greet the caller and ask how you can help — a new reservation, changing an existing " +
        "one, or something else.",
      allowed_tools: [],
    },
    {
      id: "collect_dates",
      name: "Collect dates",
      prompt_fragment:
        "Ask for the check-in and check-out dates, one at a time, and read each back before " +
        "moving on.",
      allowed_tools: [],
    },
    {
      id: "collect_guests",
      name: "Collect guest count",
      prompt_fragment: "Ask how many guests will be staying.",
      allowed_tools: [],
    },
    {
      id: "collect_room_type",
      name: "Collect room type",
      prompt_fragment:
        "Ask which room type they'd like, then quote the nightly rate strictly from " +
        "{{rate_table}} per the rate-discipline rule.",
      allowed_tools: [],
    },
    {
      id: "check_time",
      name: "Check availability",
      prompt_fragment:
        "Call check_availability for the requested dates and room type. If none_available, " +
        "offer the returned nearest_alternative first (\"I don't have that exact night open, " +
        "but I do have ...\"); if the caller still can't be accommodated, offer to take a " +
        "message so the motel can follow up if something opens.",
      allowed_tools: ["check_availability"],
    },
    {
      id: "confirm_booking",
      name: "Confirm booking",
      prompt_fragment:
        "Read back dates, guests, room type, and rate; ask the consent question; state the " +
        "cancellation policy; then create the booking. If a deposit is required " +
        "({{deposit_policy_text}}), say so and send a payment link — the reservation stays " +
        "held but not guaranteed until the deposit is paid. Send the SMS confirmation either " +
        "way.",
      allowed_tools: ["create_booking", "send_payment_link", "send_sms_confirmation"],
      is_terminal: true,
    },
    manageBookingState(),
    transferToHumanState(),
    solicitorDeflectState(),
    safetyEmergencyState(),
    takeMessageFallbackState(),
  ],
  transitions: [
    { from: "greeting", to: "collect_dates", on: { intent: "wants_to_book" } },
    { from: "greeting", to: "manage_booking", on: { intent: "wants_to_reschedule_or_cancel" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_general_message" },
    },
    { from: "collect_dates", to: "collect_guests", on: { intent: "dates_confirmed" } },
    { from: "collect_guests", to: "collect_room_type", on: { intent: "guests_confirmed" } },
    { from: "collect_room_type", to: "check_time", on: { intent: "room_type_confirmed" } },
    { from: "check_time", to: "confirm_booking", on: { predicate: "slot_selected" } },
    {
      from: "check_time",
      to: "take_message_fallback",
      on: { predicate: "none_available_and_no_alternative_accepted" },
    },
  ],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [
    checkAvailabilityTool(),
    createBookingTool(
      "Create a reservation once dates, guests, room type, and a confirmed open slot are " +
        "collected and the consent question has been asked.",
    ),
    updateBookingTool(),
    cancelBookingTool(),
    lookupCustomerTool(),
    takeMessageTool(),
    sendSmsConfirmationTool(),
    sendPaymentLinkTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
