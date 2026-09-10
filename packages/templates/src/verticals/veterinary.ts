/**
 * Veterinary — SYSTEM_DESIGN §4.1 ("conversation_flow + global emergency
 * node: red-flag escape reachable from any point in the call — structurally
 * guaranteed, not model-discretionary") + §4.3 input-collection spec:
 * "owner+phone · pet name/species/breed/age · new vs existing · triage
 * FIRST: red-flags (bloat, seizure, can't breathe, hit-by-car, toxin
 * ingestion, male cat straining, severe bleeding, blue gums) → immediate ER
 * referral/warm transfer, never diagnosis · else symptom vs routine · time."
 *
 * Vet is NOT HIPAA (animal records aren't PHI — SYSTEM_DESIGN §4.3) — no
 * BAA gate needed here, unlike dental.
 */

import type { AgentState, AgentTemplate } from "@heyloo/canonical-types";
import { DISCLOSURE_LINE } from "../shared/disclosure.js";
import { withCallOutcomeExtraction } from "../shared/extraction.js";
import {
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
  WARM_TRANSFER_FRAGMENT,
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
  solicitorDeflectState,
  takeMessageFallbackState,
  transferToHumanState,
} from "../shared/utility-states.js";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the front-desk assistant for a veterinary clinic. You book appointments, take " +
    "messages, and — most importantly — recognize when a pet needs emergency care right now. " +
    "You are never a substitute for a veterinarian: never diagnose, never say a symptom is " +
    "'probably fine', and never guess at treatment. This clinic treats {{species_treated}}; if " +
    "a caller's pet is a different species, say so honestly and offer the emergency referral " +
    "or a message either way.",
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
);

const RED_FLAG_LIST =
  "bloat/a distended abdomen, a seizure, difficulty breathing, being hit by a car, eating " +
  "something toxic, a male cat straining to urinate, severe bleeding, or pale/blue gums";

const rawStates: AgentState[] = [
  {
    id: "greeting",
    name: "Greeting",
    prompt_fragment:
      "Greet the caller and ask how you can help today — a new appointment, changing an " +
      "existing one, or something else. If they say anything suggesting the pet is in " +
      "immediate danger, do not continue this flow — go straight to the emergency referral.",
    allowed_tools: [],
  },
  {
    id: "collect_owner_phone",
    name: "Collect owner + phone",
    prompt_fragment:
      "Ask for the owner's name, then their phone number, confirming each. Call " +
      "lookup_customer with the number they're calling from — if it returns a known pet, " +
      "confirm the pet's name back to the owner instead of asking their pet info from " +
      "scratch in the next step.",
    allowed_tools: ["lookup_customer"],
  },
  {
    id: "collect_pet_info",
    name: "Collect pet info",
    prompt_fragment:
      "If lookup_customer already returned this pet's name, species, breed, and age, confirm " +
      'them back ("still Bella, the 4-year-old lab?") instead of re-asking from scratch — ' +
      "otherwise ask for each one at a time. Cross-check species against {{species_treated}}.",
    allowed_tools: [],
  },
  {
    id: "new_or_existing",
    name: "New vs existing patient",
    prompt_fragment: "Ask whether this pet has been seen at this clinic before.",
    allowed_tools: [],
  },
  {
    id: "triage_redflags",
    name: "Red-flag triage (FIRST, before any routine scheduling)",
    prompt_fragment:
      "Before discussing anything routine, explicitly ask what's going on with the pet and " +
      `listen for these red flags: ${RED_FLAG_LIST}. This triage happens BEFORE routine ` +
      "symptom/scheduling discussion, every time, for every call — never skip it. If ANY " +
      "red flag is present, do not continue this flow; move immediately to the emergency " +
      "referral. Never attempt to diagnose or reassure — your only job here is to detect a " +
      "red flag and route accordingly.",
    allowed_tools: [],
  },
  {
    id: "symptom_or_routine",
    name: "Symptom vs routine",
    prompt_fragment:
      "No red flags were present. Ask whether this is for a specific symptom or a routine " +
      "visit (wellness, vaccines, grooming, etc.) and note it for the appointment. Call " +
      "list_offerings and match it to the closest offering — pass its offering_id (never " +
      "invented) into check_availability and create_booking next.",
    allowed_tools: ["list_offerings"],
  },
  {
    id: "check_time",
    name: "Check availability",
    prompt_fragment:
      "Ask what day/time works, then call check_availability. Offer the returned open " +
      "slots; if none_available, follow the waitlist-offer rule.",
    allowed_tools: ["check_availability", "join_waitlist"],
  },
  {
    id: "confirm_booking",
    name: "Confirm booking",
    prompt_fragment:
      "Read back the pet's name, visit reason, and date/time, ask the consent question, " +
      "state the cancellation policy, then create the booking — pass structured_payload " +
      "with pet_name, species, breed, age_years, visit_reason, and symptom_or_routine from " +
      "what you gathered — and send the SMS confirmation.",
    allowed_tools: ["create_booking", "send_sms_confirmation"],
    is_terminal: true,
  },
  manageBookingState(),
  {
    id: "emergency_referral",
    name: "Emergency referral",
    prompt_fragment:
      `A red flag is present (${RED_FLAG_LIST}) or the caller otherwise describes an ` +
      "immediate danger to the pet's life. Do not diagnose, do not reassure, and do not " +
      "continue any routine scheduling. Tell the caller clearly to go to emergency care now: " +
      "refer them to {{emergency_referral_name}} at {{emergency_referral_phone}}, and ask " +
      "whether they'd like to be connected directly to this clinic right now instead, or " +
      "would rather head to the referral themselves — either way you'll also take a message " +
      "so the clinic has a record of this call.",
    // GAP_REGISTER §1.4 item 4 / vet triage bug: this state used to declare
    // BOTH take_message and transfer_call in the same allowed_tools — the
    // compiler's own contract (conversation-flow.ts header) only locks a
    // node to a SOLE tool (a Function/TransferCall node), so 2+ tools here
    // fell back to a plain ConversationNode with transfer_call wired to
    // NOTHING (unconditionally stripped from the flow's custom tools[], and
    // no native TransferCallNode was ever built for it). Split into a
    // no-tool triage/offer step plus two dedicated single-tool terminal
    // states below so both capabilities the prompt promises are actually
    // reachable by the model.
    allowed_tools: [],
    // GAP_REGISTER.md §1.1/§2 Vet item 1 — lowered by the compiler's
    // post-call-analysis pass (`packages/adapters/retell/src/compiler/
    // extraction.ts`) into Retell `post_call_analysis_data`, read back by
    // `voice-events/handler.ts`'s `handleCallAnalyzed` as
    // `emergency_detected` — a retroactive safety net that catches a red
    // flag the model may have downplayed or missed live. No separate
    // `urgency_flag` field is declared here: `call_logs.urgency_flag` is
    // derived solely from `emergency_detected` (see `voice-events/
    // handler.ts`'s `handleCallAnalyzed`) since a second field with the
    // same name but a different enum vocabulary per vertical would be
    // silently dropped by the compiler's dedup-by-field-name pass anyway
    // wherever a template also uses the shared `safetyEmergencyState()`.
    // Declared here rather than on the two terminal states below since
    // extraction fields compile to agent-level post-call analysis
    // (`extraction.ts`'s `compilePostCallAnalysisData`), keyed only by
    // field name, not per-node — reaching this parent state is what
    // "emergency detected" means, regardless of which branch follows.
    extraction: [
      {
        field: "emergency_detected",
        type: "boolean",
        description:
          "True if the call reached this emergency-referral state for any reason — a red " +
          "flag (bloat, seizure, difficulty breathing, hit by a car, toxin ingestion, a male " +
          "cat straining to urinate, severe bleeding, pale/blue gums) or another immediate " +
          "danger to the pet's life.",
      },
    ],
  },
  {
    id: "emergency_warm_transfer",
    name: "Emergency warm transfer",
    prompt_fragment:
      "The caller wants to be connected directly to this clinic right now. " +
      WARM_TRANSFER_FRAGMENT +
      " Let them know you're connecting them now, then use transfer_call.",
    allowed_tools: ["transfer_call"],
    is_terminal: true,
  },
  {
    id: "emergency_take_message",
    name: "Emergency take message",
    prompt_fragment:
      "Take a message with the owner's name, phone number, and the pet's condition so the " +
      "clinic has a record of this call, even though the caller is being directed to " +
      "emergency care (or a direct transfer) rather than a routine appointment.",
    allowed_tools: ["take_message"],
    is_terminal: true,
  },
  transferToHumanState(),
  solicitorDeflectState(),
  takeMessageFallbackState(),
];

export const VETERINARY_TEMPLATE: AgentTemplate = {
  vertical: "vet",
  compile_target: "conversation_flow",
  system_prompt: SYSTEM_PROMPT,
  states: rawStates.map(withCallOutcomeExtraction),
  transitions: [
    { from: "greeting", to: "collect_owner_phone", on: { intent: "wants_to_book_or_ask" } },
    { from: "greeting", to: "manage_booking", on: { intent: "wants_to_reschedule_or_cancel" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_general_message" },
    },
    {
      from: "collect_owner_phone",
      to: "collect_pet_info",
      on: { intent: "owner_phone_confirmed" },
    },
    { from: "collect_pet_info", to: "new_or_existing", on: { intent: "pet_info_confirmed" } },
    { from: "new_or_existing", to: "triage_redflags", on: { intent: "status_confirmed" } },
    {
      from: "triage_redflags",
      to: "emergency_referral",
      on: { predicate: "red_flag_detected" },
    },
    {
      from: "triage_redflags",
      to: "symptom_or_routine",
      on: { predicate: "no_red_flag_detected" },
    },
    {
      from: "emergency_referral",
      to: "emergency_warm_transfer",
      on: { intent: "caller_wants_direct_transfer" },
    },
    {
      from: "emergency_referral",
      to: "emergency_take_message",
      on: { intent: "caller_declines_direct_transfer" },
    },
    { from: "symptom_or_routine", to: "check_time", on: { intent: "symptom_confirmed" } },
    { from: "check_time", to: "confirm_booking", on: { predicate: "slot_selected" } },
    {
      from: "check_time",
      to: "take_message_fallback",
      on: { predicate: "none_available_and_caller_declines_waitlist" },
    },
  ],
  global_intents: [
    // SYSTEM_DESIGN §4.1's canonical example: reachable from ANY state, not just triage_redflags —
    // a red flag can surface at any point in the call, not only during the dedicated triage question.
    safetyEmergencyGlobalIntent("emergency_referral"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [
    checkAvailabilityTool(),
    listOfferingsTool(),
    createBookingTool(
      "Create an appointment once pet info, visit reason, and a confirmed open time are " +
        "collected and the consent question has been asked. Never used for a red-flag call — " +
        "those go to emergency referral instead.",
      "vet",
    ),
    updateBookingTool(),
    cancelBookingTool(),
    joinWaitlistTool(),
    lookupCustomerTool(),
    takeMessageTool("vet"),
    sendSmsConfirmationTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
