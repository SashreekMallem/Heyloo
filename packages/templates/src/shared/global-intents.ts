/**
 * Shared `GlobalIntent` builders — `human_request` and `solicitor` are
 * required on EVERY template (BUILD task item 1); every template also
 * declares an `emergency` escape (vet's is a real red-flag triage flow
 * authored per-vertical in `verticals/veterinary.ts`; every other vertical
 * gets the shared safety-net version below, since a caller describing a
 * genuine medical/life emergency can call ANY business's number).
 *
 * Every intent here uses `reachable_from: "any"` — SYSTEM_DESIGN §4.1's
 * "reachable from any point in the call — structurally guaranteed, not
 * model-discretionary" applied uniformly, which is exactly the invariant
 * the red-team suite asserts holds for every template.
 */

import type { GlobalIntent } from "@heyloo/canonical-types";

export function humanRequestGlobalIntent(targetState: string): GlobalIntent {
  return {
    name: "human_request",
    reachable_from: "any",
    target_state: targetState,
    description: "The caller explicitly asks to speak with a human, a manager, or the owner.",
  };
}

export function solicitorGlobalIntent(targetState: string): GlobalIntent {
  return {
    name: "solicitor",
    reachable_from: "any",
    target_state: targetState,
    description: "The caller is a salesperson/vendor calling the business itself, not a customer.",
  };
}

/**
 * The generic 911-referral safety net for every non-vet vertical (vet has
 * its own richer red-flag triage instead — see `verticals/veterinary.ts`).
 * A caller describing a life-threatening emergency reaches ANY business's
 * phone number sometimes; this exists so that case is never left to the
 * model's discretion, regardless of vertical.
 */
export function safetyEmergencyGlobalIntent(targetState: string): GlobalIntent {
  return {
    name: "emergency",
    reachable_from: "any",
    target_state: targetState,
    description:
      "The caller describes a life-threatening medical emergency, a fire, a crime in " +
      "progress, or any other immediate danger to life or property.",
  };
}

/**
 * The structural target for `GIVE_UP_LADDER_FRAGMENT`'s "move to a transfer
 * or a take-message fallback instead of guessing" — reachable from every
 * state so a call that can't be completed in real time (repeated
 * misunderstandings, the caller needs to go, no human is available to
 * transfer to) always has a place to land that still records whatever was
 * gathered so far, rather than silently discarding it. Not every template
 * wires this yet (auto-repair/dental/motel/restaurant/vet currently only
 * reach `take_message_fallback` via a couple of specific transitions, e.g.
 * greeting/none_available) — legal is the first to need the fully general
 * "any state" version, since its multi-step intake (conflict check,
 * urgency, referral source) has the most to lose from an ungraceful exit.
 */
export function giveUpGlobalIntent(targetState: string): GlobalIntent {
  return {
    name: "give_up",
    reachable_from: "any",
    target_state: targetState,
    description:
      "The call cannot be completed in real time right now — repeated misunderstandings, or " +
      "the caller needs to go and would rather leave a message than keep trying.",
  };
}
