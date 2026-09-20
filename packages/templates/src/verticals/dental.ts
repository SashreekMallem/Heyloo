/**
 * Dental — SYSTEM_DESIGN §4.1 (conversation_flow) + §4.3 input-collection
 * spec: "patient name · new vs existing · pain triage (pain/swelling/fever/
 * knocked-out tooth → urgency tiers, same-day check) · time. DOB/insurance
 * deferred to a secure post-call form link — PHI stays out of transcripts
 * where possible."
 */

import type { AgentState, AgentTemplate } from "@heyloo/canonical-types";
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
  listOfferingsTool,
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

const PHI_DEFERRAL_FRAGMENT =
  "Never ask for the patient's date of birth, insurance details, or SSN over the phone — " +
  "those are collected later through a secure post-call form link so they stay out of the " +
  "call transcript. If the caller volunteers them anyway, don't repeat them back or dwell on " +
  "them — just acknowledge and move on.";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the front-desk assistant for a dental office. You book appointments, triage pain " +
    "complaints for urgency, and take messages. You are never a substitute for a dentist — " +
    "never diagnose, and never promise a specific treatment or price.",
  PHI_DEFERRAL_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
);

const rawStates: AgentState[] = [
  {
    id: "greeting",
    name: "Greeting",
    prompt_fragment:
      "Greet the caller and ask how you can help — a new appointment, changing an existing " +
      "one, or something else.",
    allowed_tools: [],
  },
  {
    id: "collect_patient_name",
    name: "Collect patient name",
    prompt_fragment:
      "Ask for the patient's full name (the person being seen, which may differ from the " +
      "caller for a child or dependent) and confirm it.",
    allowed_tools: [],
  },
  {
    id: "new_or_existing",
    name: "New vs existing patient",
    prompt_fragment:
      "Ask whether this patient has been seen at this office before. If the caller is on an " +
      "existing patient's own number, you may call lookup_customer to confirm.",
    allowed_tools: ["lookup_customer"],
  },
  {
    id: "pain_triage",
    name: "Pain triage",
    prompt_fragment:
      "Ask if this visit is for pain or a routine check-up, and — either way — what the " +
      "visit is actually for in the caller's own words (e.g. cleaning, filling, a broken " +
      "tooth, a check-up); note that as the reason for visit. If pain: ask about pain level " +
      "(0-10), swelling, fever, and specifically whether a tooth was knocked out or badly " +
      "broken — any of those is a same-day urgency tier, so flag it clearly and prioritize " +
      "the earliest possible slot in the next step. If there's severe facial swelling " +
      "affecting breathing or swallowing, treat this as a safety emergency instead of " +
      "routine triage. Once you know the visit type, call list_offerings ONCE and match it to " +
      "the closest offering — pass its offering_id (never invented) into check_availability " +
      "and create_booking next. Never call list_offerings again for the rest of this call — " +
      "reuse the result you already have.",
    allowed_tools: ["list_offerings"],
    // GAP_REGISTER.md §1.1/§2 Dental item 1 — lowered into Retell
    // post-call-analysis (`compiler/extraction.ts`) and read back by
    // `voice-events/handler.ts`'s `handleCallAnalyzed` as
    // `emergency_detected` — a retroactive safety net catching a
    // same-day-urgency case the model handled inline but didn't escalate
    // to `safety_emergency`. No separate `urgency_flag` field is declared
    // here: `call_logs.urgency_flag` is derived solely from
    // `emergency_detected` (see `voice-events/handler.ts`'s
    // `handleCallAnalyzed`) — a second field named `urgency_flag` with
    // this state's own tier vocabulary ('same_day'/'routine') would
    // collide, and be silently dropped, against the shared
    // `safetyEmergencyState()`'s occurrence of the same field name later
    // in this template's `states[]` (the compiler's post-call-analysis
    // pass dedupes by field name, first declaration wins). Because this
    // boolean is the one and only signal the dashboard's urgency alert is
    // derived from, its description below is kept word-for-word aligned
    // with this state's own "same-day urgency tier" trigger list above
    // (pain, swelling, fever, knocked-out/badly-broken tooth) — not just
    // the narrower true-emergency subset — so a same-day case the model
    // handles inline without escalating (e.g. fever + swelling, no broken
    // tooth) still raises the alert instead of silently landing only in
    // the unstructured `extracted_entities` blob.
    extraction: [
      {
        field: "emergency_detected",
        type: "boolean",
        description:
          "True if the caller reported any of this same-day urgency tier's triggers — " +
          "significant pain, swelling, fever, or a knocked-out or badly broken tooth — or " +
          "facial swelling affecting breathing/swallowing (a safety emergency) during this " +
          "call.",
      },
    ],
  },
  {
    id: "check_time",
    name: "Check availability",
    prompt_fragment:
      "If same-day urgency was flagged, ask check_availability for the soonest possible " +
      "window today; otherwise ask what day/time works. Offer the returned open slots; if " +
      "none_available, follow the waitlist-offer rule (for a same-day urgent case, also " +
      "offer to take a message so the office can call back immediately if nothing opens).",
    allowed_tools: ["check_availability", "join_waitlist"],
  },
  {
    id: "confirm_booking",
    name: "Confirm booking",
    prompt_fragment:
      "Read back the patient name, reason for visit, and date/time, ask the consent " +
      "question, state the cancellation policy, then create the booking — pass " +
      "structured_payload with new_or_existing, reason_for_visit, and pain_level (if " +
      "asked) — and send the SMS confirmation, including a mention that a secure link for " +
      "insurance/DOB will follow separately.",
    allowed_tools: ["create_booking", "send_sms_confirmation"],
    is_terminal: true,
  },
  manageBookingState(),
  transferToHumanState(),
  solicitorDeflectState(),
  safetyEmergencyState(),
  takeMessageFallbackState(),
];

export const DENTAL_TEMPLATE: AgentTemplate = {
  vertical: "dental",
  compile_target: "conversation_flow",
  system_prompt: SYSTEM_PROMPT,
  states: rawStates.map(withCallOutcomeExtraction),
  transitions: [
    { from: "greeting", to: "collect_patient_name", on: { intent: "wants_to_book" } },
    { from: "greeting", to: "manage_booking", on: { intent: "wants_to_reschedule_or_cancel" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_general_message" },
    },
    {
      from: "collect_patient_name",
      to: "new_or_existing",
      on: { intent: "patient_name_confirmed" },
    },
    { from: "new_or_existing", to: "pain_triage", on: { intent: "status_confirmed" } },
    { from: "pain_triage", to: "check_time", on: { intent: "triage_complete" } },
    { from: "check_time", to: "confirm_booking", on: { predicate: "slot_selected" } },
    {
      from: "check_time",
      to: "take_message_fallback",
      on: { predicate: "none_available_and_caller_declines_waitlist" },
    },
  ],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [
    checkAvailabilityTool(),
    listOfferingsTool(),
    createBookingTool(
      "Create an appointment once the patient name, triage result, and a confirmed open time " +
        "are collected and the consent question has been asked.",
      "dental",
    ),
    updateBookingTool(),
    cancelBookingTool(),
    joinWaitlistTool(),
    lookupCustomerTool(),
    takeMessageTool("dental"),
    sendSmsConfirmationTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
