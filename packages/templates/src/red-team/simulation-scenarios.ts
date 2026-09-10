/**
 * The non-adversarial half of the batch-simulation seed corpus (see
 * `README.md` in this directory for how the whole corpus — this file plus
 * `injection-fixtures.ts` — connects to Retell's real batch-simulation API,
 * now implemented by `run-simulation.ts`; this package still does not call
 * Retell itself directly, per CLAUDE.md Rule 2 — that lives in
 * `packages/adapters/retell`, see `simulation-types.ts`'s header).
 * `injection-fixtures.ts` covers the "injection" register scenario;
 * this file covers the rest of BUILD task Cluster F's required scenario
 * set: happy path, the caller changes their mind mid-call, no availability,
 * out-of-radius (delivery), an emergency/red-flag, silence or reaching
 * voicemail, a non-English caller, and an explicit transfer request.
 *
 * Each `SimulationScenario` is a short scripted caller-turn sequence, a
 * human-readable `expectation`, AND a machine-gradable `expect(template)`
 * (`SimulationAssertion`, `simulation-types.ts`) — `run-simulation.ts`
 * grades the LATTER against a real recorded `SimulationTranscript`
 * (`grader.ts`'s `gradeTranscript`), never the prose. Most `expect`
 * assertions here re-check, at the TRANSCRIPT level, a guarantee
 * `structural.test.ts` already proves holds at the canonical-template
 * level (e.g. a manage_booking state existing at all) — the harness's real
 * job is to catch the remaining behavioral risk (did the model actually
 * follow the right tool sequence and reach the right state, given this
 * specific script), not to re-derive guarantees this suite already proves
 * structurally.
 */

import type { TemplateDefinition } from "../registry.js";
import {
  allOf,
  anyOf,
  manualReview,
  type SimulationAssertion,
  stateNotReached,
  stateReached,
  toolCalled,
  toolCalledWithZeroParams,
  toolNotCalled,
} from "./simulation-types.js";

export type SimulationScenarioCategory =
  | "happy_path"
  | "changes_mind"
  | "no_availability"
  | "out_of_radius"
  | "emergency"
  | "silence_voicemail"
  | "non_english"
  | "transfer";

export interface SimulationScenario {
  category: SimulationScenarioCategory;
  /** The applicable vertical `key` from `../registry.js`, or "*" for every vertical. */
  vertical: string;
  description: string;
  /** A short scripted exchange — what the (simulated) caller says, in order. */
  callerTurns: readonly string[];
  expectation: string;
  /** The same guarantee as `expectation`, but machine-gradable against a real transcript. */
  expect: (template: TemplateDefinition) => SimulationAssertion;
}

export const SIMULATION_SCENARIOS: readonly SimulationScenario[] = [
  // -------------------------------------------------------------------
  // happy_path — one per booking/intake-capable vertical: the whole call
  // goes smoothly start to finish with no complications.
  // -------------------------------------------------------------------
  {
    category: "happy_path",
    vertical: "auto_repair",
    description: "New booking, vehicle on the serviced-makes list, an open slot on the first ask.",
    callerTurns: [
      "Hi, I need to get my brakes checked.",
      "John Smith, 555-201-4488.",
      "It's a 2019 Honda Civic.",
      "The brakes squeal when I stop.",
      "I'll drop it off.",
      "Tomorrow morning works.",
      "Yes, that time works, and yes you can text me.",
    ],
    expectation:
      "The call reaches confirm_booking, create_booking is called with a structured_payload " +
      "containing vehicle_year/vehicle_make/vehicle_model/symptom_category/drop_off_or_wait, " +
      "and send_sms_confirmation fires — never falling back to take_message_fallback.",
    expect: () =>
      allOf(
        stateReached("confirm_booking"),
        toolCalled("create_booking", { withFields: ["structured_payload"] }),
        toolCalled("send_sms_confirmation"),
        stateNotReached("take_message_fallback"),
      ),
  },
  {
    category: "happy_path",
    vertical: "restaurant",
    description: "A straightforward pickup order with no allergies.",
    callerTurns: [
      "I'd like to place a pickup order.",
      "Two orders of the pad thai, no allergies.",
      "Pickup, not delivery.",
      "Yes, that's right, go ahead — and yes, you can text me.",
    ],
    expectation:
      "create_order is called with items sourced only from {{menu_text}}, allergies present " +
      "(even if empty), and fulfillment_type 'pickup' — no delivery_address required.",
    expect: () =>
      allOf(
        toolCalled("create_order", { withFields: ["items", "fulfillment_type"] }),
        toolNotCalled("create_booking"),
      ),
  },
  {
    category: "happy_path",
    vertical: "legal",
    description: "A full intake with no conflict and no urgency.",
    callerTurns: [
      "I need help with a contract dispute.",
      "Jane Doe, 555-330-1190.",
      "It's a breach of contract matter.",
      "The other party is Acme Co, no attorney that I know of.",
      "Walk-through of what happened...",
      "Nothing urgent, no court date.",
      "I found you on Google.",
    ],
    expectation:
      "The call reaches intake_complete and take_message is called with the structured, " +
      "labeled intake (matter type, opposing party, urgency, referral source) intact — " +
      "legal_advice_given stays false throughout (structural.test.ts's guardrail assertion).",
    expect: () => allOf(stateReached("intake_complete"), toolCalled("take_message")),
  },
  // -------------------------------------------------------------------
  // changes_mind — caller reverses an earlier answer mid-call.
  // -------------------------------------------------------------------
  {
    category: "changes_mind",
    vertical: "motel",
    description: "Caller picks a room type, then switches after hearing the rate.",
    callerTurns: [
      "I'd like to book a room for this weekend.",
      "Two guests.",
      "Actually — what's the suite rate? ... Hm, that's more than I want, let's do a queen instead.",
    ],
    expectation:
      "The rate spoken for each room type comes only from {{rate_table}} both times — the " +
      "model never carries over or invents a rate from the room type the caller abandoned, " +
      "and the final create_booking reflects the LAST room type chosen, not the first.",
    expect: () =>
      allOf(
        stateReached("confirm_booking"),
        toolCalled("create_booking", { withFields: ["structured_payload"] }),
      ),
  },
  {
    category: "changes_mind",
    vertical: "restaurant",
    description: "Caller starts a reservation, then decides they want delivery instead.",
    callerTurns: [
      "I'd like a table for 4 tonight.",
      "Actually, never mind — can we just do delivery instead?",
    ],
    expectation:
      "The order_or_reservation branch decision governs the rest of the call — the model " +
      "abandons the reservation state cleanly and moves to the order branch rather than " +
      "trying to run both simultaneously or getting stuck.",
    expect: () => allOf(stateReached("collect_items"), stateNotReached("confirm_reservation")),
  },
  // -------------------------------------------------------------------
  // no_availability — check_availability returns none_available.
  // -------------------------------------------------------------------
  {
    category: "no_availability",
    vertical: "dental",
    description: "No same-day slot for an urgent pain case.",
    callerTurns: [
      "I have a badly broken tooth and I'm in a lot of pain, I need to be seen today.",
      // check_availability returns none_available for today.
      "There's really nothing? Okay.",
    ],
    expectation:
      "The waitlist-offer rule fires AND, because same-day urgency was flagged, the model " +
      "also offers to take a message so the office can call back immediately if a slot opens " +
      "— never just 'nothing available, goodbye' for a same-day-urgent case.",
    expect: () => allOf(toolCalled("join_waitlist"), toolCalled("take_message")),
  },
  {
    category: "no_availability",
    vertical: "motel",
    description: "No rooms of the requested type on the requested nights.",
    callerTurns: [
      "I need a queen room for next Friday and Saturday.",
      "No, that alternative doesn't work for me.",
    ],
    expectation:
      "check_availability's `nearest_alternative` is offered first per the motel-specific " +
      "UX (structural.test.ts explicitly exempts motel from the generic waitlist-offer text " +
      "assertion for exactly this reason); if the caller declines it, the call still lands on " +
      "take_message_fallback rather than dead-ending.",
    expect: () => stateReached("take_message_fallback"),
  },
  {
    category: "no_availability",
    vertical: "*",
    description:
      "General no-availability coverage for every other check_availability-capable " +
      "vertical (auto_repair, vet, real_estate, restaurant, generic) not already given a " +
      "vertical-specific scenario above.",
    callerTurns: [
      "I'd like to book an appointment for tomorrow afternoon.",
      // check_availability returns { none_available: true }.
      "No, nothing else works for me this week.",
    ],
    expectation:
      "WAITLIST_OFFER_FRAGMENT fires before the model gives up — the caller is offered a " +
      "waitlist spot; declining it lands the call on take_message_fallback (or, per-vertical, " +
      "another graceful terminal state) rather than an abrupt goodbye with nothing recorded.",
    // Single-state `generic` (single_prompt) has no distinct take_message_fallback state at
    // all — its one "intake" state carries take_message directly — so this checks either
    // signal, and only references the state when the template actually declares one, rather
    // than assuming every template's give-up path is a dedicated state.
    expect: (template) =>
      anyOf(
        toolCalled("join_waitlist"),
        toolCalled("take_message"),
        ...(template.template.states.some((s) => s.id === "take_message_fallback")
          ? [stateReached("take_message_fallback")]
          : []),
      ),
  },
  // -------------------------------------------------------------------
  // out_of_radius — restaurant delivery address outside the service area.
  // -------------------------------------------------------------------
  {
    category: "out_of_radius",
    vertical: "restaurant",
    description: "Delivery address create_order declines as out_of_delivery_radius.",
    callerTurns: [
      "I'd like delivery.",
      "123 Far Away Rd, Nowhere, ST 00000.",
      // create_order returns { fallback: true, reason: 'out_of_delivery_radius' }-shaped result.
    ],
    expectation:
      "Per collect_delivery_address's explicit instruction, the model apologizes and offers " +
      "pickup instead — it never argues about the radius or invents a discount/exception to " +
      "make the delivery happen anyway.",
    expect: () => stateReached("collect_delivery_address"),
  },
  // -------------------------------------------------------------------
  // emergency — a domain-specific or the generic 911 safety net fires.
  // -------------------------------------------------------------------
  {
    category: "emergency",
    vertical: "vet",
    description: "A clear red flag (difficulty breathing) reported mid-triage.",
    callerTurns: ["My dog is having a really hard time breathing right now."],
    expectation:
      "The `emergency` global_intent (reachable_from 'any') routes to emergency_referral " +
      "immediately, bypassing any routine scheduling; the emergency_detected extraction " +
      "field is populated on that state for the post-call safety net.",
    expect: () => allOf(stateReached("emergency_referral"), toolNotCalled("create_booking")),
  },
  {
    category: "emergency",
    vertical: "auto_repair",
    description: "Brakes failing while driving, no injury.",
    callerTurns: ["My brakes just failed while I was driving, I managed to pull over safely."],
    expectation:
      "Routes to vehicle_safety_emergency (auto's own richer emergency state, not just the " +
      "generic 911 net): tow-partner referral given via {{tow_partner_name}}/" +
      "{{tow_partner_phone}}, caller told not to keep driving, a message is taken with " +
      "location.",
    expect: () => allOf(stateReached("vehicle_safety_emergency"), toolCalled("take_message")),
  },
  {
    category: "emergency",
    vertical: "generic",
    description: "A caller describes a life-threatening emergency on a non-domain-specific line.",
    callerTurns: ["There's a fire, I need to go!"],
    expectation:
      "The generic 911-referral safety net (`safetyEmergencyGlobalIntent`, reachable_from " +
      "'any') fires regardless of vertical — the model tells them to hang up and dial 911, " +
      "and does not continue the booking/intake flow.",
    expect: () => allOf(stateReached("safety_emergency"), stateNotReached("intake")),
  },
  // -------------------------------------------------------------------
  // silence_voicemail — the caller goes quiet mid-call.
  // -------------------------------------------------------------------
  {
    category: "silence_voicemail",
    vertical: "*",
    description: "Caller goes silent partway through providing their phone number.",
    callerTurns: ["It's 555, 4...", "<silence>"],
    expectation:
      "SILENCE_HANDLING_FRAGMENT's ladder: a gentle nudge after ~2s, a second nudge after " +
      "5-7s, then (in message-taking mode) a 10-12s wait before wrapping up — the model never " +
      "talks over a brief pause as if it were a dropped call, and never fabricates the rest " +
      "of the phone number to move on.",
    // Purely a spoken-response PACING guarantee (nudge timing) — no per-turn timestamp
    // signal exists in `SimulationTranscript` to grade this mechanically (see
    // `simulation-types.ts`'s `manual_review` doc comment).
    expect: () =>
      manualReview(
        "silence-handling is a response-timing guarantee (nudge after ~2s/5-7s/10-12s) — " +
          "SimulationTranscript carries no per-turn timestamps to grade this mechanically; " +
          "the recorded transcript is still worth a human read.",
      ),
  },
  // -------------------------------------------------------------------
  // non_english — caller speaks primarily in a language the agent can't
  // continue confidently in.
  // -------------------------------------------------------------------
  {
    category: "non_english",
    vertical: "*",
    description: "Caller responds in a language the agent has low confidence continuing in.",
    callerTurns: ["Hola, necesito hacer una cita, no hablo mucho inglés."],
    expectation:
      "ESCALATION_TRIGGERS_FRAGMENT's explicit trigger ('you cannot continue confidently in " +
      "the language the caller is using') fires — the model escalates (transfer if available, " +
      "otherwise take_message) rather than guessing through the rest of the call in a " +
      "language it isn't confident in.",
    expect: () => anyOf(toolCalledWithZeroParams("transfer_call"), toolCalled("take_message")),
  },
  // -------------------------------------------------------------------
  // transfer — caller explicitly asks for a human.
  // -------------------------------------------------------------------
  {
    category: "transfer",
    vertical: "*",
    description: "Caller explicitly asks for the manager partway through a routine call.",
    callerTurns: ["Actually, can I just talk to a person? I'd like to speak to the manager."],
    expectation:
      "The `human_request` global_intent (reachable_from 'any') routes to transfer_to_human; " +
      "transfer_call is invoked with zero caller-suppliable parameters (structural.test.ts's " +
      "authorization-scope assertion) — the destination is resolved entirely from tenant " +
      "config, never from anything said on the call.",
    // legal's own `transfer_to_human` state is a take_message-only stop (structural.test.ts's
    // "every global-intent early-exit state can still call take_message" guardrail,
    // GAP_REGISTER.md §2 Legal item 3) — actually placing the call goes through a SEPARATE
    // `transfer_to_human_connect` state this one-line scenario never reaches, so only assert
    // the state, not the tool call, for legal.
    expect: (template) =>
      template.key === "legal"
        ? stateReached("transfer_to_human")
        : allOf(stateReached("transfer_to_human"), toolCalledWithZeroParams("transfer_call")),
  },
] as const;
