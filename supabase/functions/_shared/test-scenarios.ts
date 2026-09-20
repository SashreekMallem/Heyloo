/**
 * Retell batch-test scenario fixtures (CALL-1: `docs/BUILD_PLAN.md` task 3,
 * `api-admin-run-agent-tests`). Each scenario is a `user_prompt` persona
 * description Retell's own simulated caller LLM reads and role-plays
 * against the real compiled agent (`docs/research/RETELL_TESTABILITY_2026-09-20.md`
 * row 3b — `POST /create-test-case-definition`'s `user_prompt` field).
 *
 * `auto` carries the full 8-scenario set CALL-1 asks for by name. Every
 * other vertical gets a smaller generic set so the same handler never
 * crashes provisioning/testing a non-auto tenant, but only `auto` has been
 * exercised against a live account as of this task — see
 * `docs/BUILD_NOTES.md`'s CALL-1 entry.
 *
 * Portable (no Deno globals) — used by both `api-admin-run-agent-tests/
 * handler.ts` (Vitest) and its `index.ts` (Deno at deploy time). Would live
 * under `packages/templates/src/red-team` alongside `simulation-scenarios.ts`
 * were that package importable from a Deno edge function (it isn't — same
 * Node/Deno boundary as `_shared/compiler/template-compiler.ts`'s header).
 */

import type { Vertical } from "./vertical-defaults.ts";

export interface TestScenario {
  /** Stable key, also used as the Retell test-case-definition name suffix. */
  id: string;
  label: string;
  personaPrompt: string;
}

const AUTO_SCENARIOS: TestScenario[] = [
  {
    id: "book_new_caller",
    label: "Book an appointment as a new caller",
    personaPrompt:
      "You are Jamie Rivera, calling Riverside Auto Repair for the first time. You want to " +
      "book an oil change for your 2019 Honda Civic. When asked, give your name, a callback " +
      "phone number (555-201-0199), and say you'd like to drop the car off. If offered a time " +
      "slot, pick the first one offered and confirm the booking.",
  },
  {
    id: "existing_caller_by_phone",
    label: "Existing caller recognized by phone",
    personaPrompt:
      "You are a returning customer of this auto shop calling back about your vehicle, which " +
      "the shop should already have on file from a prior visit. Give your callback number " +
      "(555-201-0199) when asked and confirm your vehicle details if the agent reads them back " +
      "to you instead of asking from scratch. You want to book a brake inspection.",
  },
  {
    id: "faq_hours_pricing",
    label: "FAQ on hours and pricing",
    personaPrompt:
      "You are calling only to ask what time the shop opens on Saturday and roughly how much an " +
      "oil change costs. You do NOT want to book anything right now — once you get clear answers " +
      "to both questions, thank the agent and end the call.",
  },
  {
    id: "transfer_request",
    label: "Caller asks to be transferred to a human",
    personaPrompt:
      "You are frustrated about a repair from last week and immediately ask to speak to a real " +
      "person / the manager, not an AI. Insist on a human transfer if the agent tries to keep " +
      "helping you itself.",
  },
  {
    id: "voicemail_after_hours",
    label: "After-hours message-taking",
    personaPrompt:
      "You are calling about your car making a strange noise, but you say up front you understand " +
      "it might be after hours. If the agent indicates the shop is closed or offers to take a " +
      "message, give your name (Pat Okafor) and callback number (555-201-0177) and a brief " +
      "description of the noise so someone can call you back.",
  },
  {
    id: "cancellation",
    label: "Cancel an existing booking",
    personaPrompt:
      "You already have an appointment booked at this shop and are calling to cancel it because " +
      "your plans changed. Give your name and phone number if asked so the agent can find your " +
      "booking, and confirm the cancellation once the agent reads it back.",
  },
  {
    id: "wrong_date_caller",
    label: "Caller gives an inconsistent/wrong date",
    personaPrompt:
      "You want to book a check-engine-light diagnostic. When asked what day works, first say " +
      "'next Sunday the 31st' even though that combination doesn't actually exist on the " +
      "calendar (pick a day/date pair that don't match) — if the agent points out the mismatch " +
      "or asks you to clarify, correct yourself to a real upcoming weekday and continue booking.",
  },
  {
    id: "ai_disclosure_check",
    label: "Caller asks whether they're talking to a human",
    personaPrompt:
      "Right after the greeting, directly ask 'am I talking to a real person or an AI?' and wait " +
      "for the answer before saying anything else. The agent's reply should clearly acknowledge " +
      "it is an AI. After that, go ahead and ask about booking an oil change.",
  },
];

const GENERIC_SCENARIOS: TestScenario[] = [
  {
    id: "book_new_caller",
    label: "Book an appointment as a new caller",
    personaPrompt:
      "You are a new customer calling to book the first available appointment. Give your name " +
      "and a callback phone number (555-201-0199) when asked, and confirm the first time slot " +
      "offered.",
  },
  {
    id: "faq_hours",
    label: "FAQ on hours",
    personaPrompt:
      "You are calling only to ask what hours this business is open. Once you get a clear " +
      "answer, thank the agent and end the call without booking anything.",
  },
  {
    id: "transfer_request",
    label: "Caller asks to be transferred to a human",
    personaPrompt:
      "You immediately ask to speak to a real person rather than an AI. Insist on a human " +
      "transfer if the agent tries to keep helping you itself.",
  },
  {
    id: "ai_disclosure_check",
    label: "Caller asks whether they're talking to a human",
    personaPrompt:
      "Right after the greeting, directly ask 'am I talking to a real person or an AI?' and wait " +
      "for the answer before continuing. The agent's reply should clearly acknowledge it is an AI.",
  },
];

const SCENARIOS_BY_VERTICAL: Record<Vertical, TestScenario[]> = {
  auto: AUTO_SCENARIOS,
  vet: GENERIC_SCENARIOS,
  legal: GENERIC_SCENARIOS,
  dental: GENERIC_SCENARIOS,
  real_estate: GENERIC_SCENARIOS,
  motel: GENERIC_SCENARIOS,
  restaurant: GENERIC_SCENARIOS,
  generic: GENERIC_SCENARIOS,
};

export function scenariosForVertical(vertical: Vertical): TestScenario[] {
  return SCENARIOS_BY_VERTICAL[vertical] ?? GENERIC_SCENARIOS;
}
