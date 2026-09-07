/**
 * Shared terminal/utility `AgentState`s reused across every conversation_flow
 * / multi_prompt template: the three global-intent targets every template
 * needs (`transfer_to_human`, `solicitor_deflect`, a generic
 * `safety_emergency` 911 referral) plus the reschedule/cancel branch
 * (`manage_booking`, MASTER_SPEC §3.7 identity fallback) and a catch-all
 * message-taking fallback for the give-up ladder (SYSTEM_DESIGN §4.5).
 *
 * Authored once so their wording and `allowed_tools` wiring can't drift
 * per-vertical — each vertical file just splices these into its own
 * `states[]` array alongside its vertical-specific collection states.
 */

import type { AgentState } from "@heyloo/canonical-types";
import { IDENTITY_FALLBACK_FRAGMENT, WARM_TRANSFER_FRAGMENT } from "./fragments.js";

export function transferToHumanState(): AgentState {
  return {
    id: "transfer_to_human",
    name: "Transfer to human",
    prompt_fragment:
      "The caller wants a human. " +
      WARM_TRANSFER_FRAGMENT +
      " Let the caller know you're connecting them now, then use transfer_call.",
    allowed_tools: ["transfer_call"],
    is_terminal: true,
  };
}

export function solicitorDeflectState(): AgentState {
  return {
    id: "solicitor_deflect",
    name: "Solicitor deflection",
    prompt_fragment:
      "This caller is a salesperson or vendor calling the business, not a customer. " +
      "Politely decline — never transfer a solicitor to the owner or staff. Offer to take a " +
      "brief message ONLY if they ask; otherwise it's fine to end the call politely without " +
      "recording anything.",
    allowed_tools: ["take_message"],
    is_terminal: true,
  };
}

export function safetyEmergencyState(): AgentState {
  return {
    id: "safety_emergency",
    name: "Safety emergency referral",
    prompt_fragment:
      "The caller describes a life-threatening emergency, a fire, a crime in progress, or " +
      "similar immediate danger. Do not attempt to help beyond this: calmly tell them to hang " +
      "up and dial 911 (or their local emergency number) right away. Do not continue the " +
      "original booking conversation.",
    allowed_tools: ["take_message"],
    is_terminal: true,
  };
}

export function manageBookingState(): AgentState {
  return {
    id: "manage_booking",
    name: "Reschedule or cancel an existing booking",
    prompt_fragment:
      "The caller wants to reschedule or cancel an existing appointment. Look them up with " +
      "lookup_customer using the number they're calling from. " +
      IDENTITY_FALLBACK_FRAGMENT +
      " Once identity is settled, use update_booking to reschedule or cancel_booking to " +
      "cancel, and state the cancellation policy again if they're cancelling.",
    allowed_tools: ["lookup_customer", "update_booking", "cancel_booking"],
    is_terminal: true,
  };
}

export function takeMessageFallbackState(): AgentState {
  return {
    id: "take_message_fallback",
    name: "Take a message (fallback)",
    prompt_fragment:
      "You were not able to complete this in real time (after-hours, repeated " +
      "misunderstandings, or the caller asked to leave a message instead). Collect the " +
      "caller's name, phone number, and a short message, and let them know when to expect a " +
      "call back.",
    allowed_tools: ["take_message"],
    is_terminal: true,
  };
}
