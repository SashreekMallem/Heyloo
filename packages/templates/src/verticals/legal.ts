/**
 * Legal intake — SYSTEM_DESIGN §4.1 (multi_prompt: "hard-gated conflict-
 * check + no-advice guardrail per state, with open empathetic discovery a
 * rigid graph would flatten") + §4.3 input-collection spec: "name+phone ·
 * matter type · open discovery ('walk me through it') · urgency (SOL,
 * custody, court date) · opposing party full name BEFORE substantive
 * discussion (conflict check — flagged for human review, never
 * auto-cleared) · referral source." Hard guardrail: no legal advice, no
 * merits opinion, no fee quotes beyond the configured consult fee;
 * `legal_advice_given` must always be false — every state below carries
 * BOTH the guardrail text and the extraction field (via `withLegalGuardrail`
 * below), never left to chance on any one state.
 */

import type { AgentState, AgentTemplate } from "@heyloo/canonical-types";
import { DISCLOSURE_LINE } from "../shared/disclosure.js";
import { withCallOutcomeExtraction } from "../shared/extraction.js";
import { WARM_TRANSFER_FRAGMENT } from "../shared/fragments.js";
import {
  giveUpGlobalIntent,
  humanRequestGlobalIntent,
  safetyEmergencyGlobalIntent,
  solicitorGlobalIntent,
} from "../shared/global-intents.js";
import { buildSystemPrompt } from "../shared/system-prompt.js";
import { lookupCustomerTool, takeMessageTool, transferCallTool } from "../shared/tools.js";
import {
  safetyEmergencyState,
  solicitorDeflectState,
  takeMessageFallbackState,
  transferToHumanState,
} from "../shared/utility-states.js";

/**
 * GAP_REGISTER.md §2 Legal item 3 — the shared `transferToHumanState()`
 * only allows `transfer_call`, so the `human_request` global intent
 * (`reachable_from: "any"`, wired below) could fire mid-intake — e.g. right
 * after the caller names the opposing party in `conflict_check`, before
 * `intake_complete` — and drop everything gathered so far, since
 * `transfer_call` never touches `call_logs` and the state has no
 * `take_message` fallback to fall back to. Legal has the most to lose from
 * that (the conflict-check answer specifically), so it overrides the
 * shared state with a legal-aware pair of states that always records an
 * intake message BEFORE transferring, same as `takeMessageFallbackState()`'s
 * "fold in whatever you already gathered" pattern.
 *
 * `zAgentTemplate`'s structural check forbids `transfer_call` sharing a
 * state's `allowed_tools` with any other tool (it's only ever lowered as a
 * state's SOLE tool by every compiler target — `agent-template.ts`), so
 * this can't be one state that calls both. Split the same way
 * `verticals/veterinary.ts`'s `emergency_referral` splits triage from the
 * transfer itself: a `take_message`-only intake step (the global intent's
 * actual target, `transfer_to_human`) that always transitions on to a
 * dedicated `transfer_call`-only terminal state.
 */
function legalTransferToHumanStates(): AgentState[] {
  const base = transferToHumanState();
  return [
    {
      ...base,
      id: "transfer_to_human",
      name: "Transfer to human (record intake first)",
      prompt_fragment:
        "The caller wants a human. Before connecting them, first call take_message with " +
        "whatever you've already gathered this call — name, phone, matter type, the opposing " +
        "party for the conflict check, urgency, referral source, and a short summary of what " +
        "they've described — using the same labeled-line format you always use for intake, " +
        "even if it's incomplete. This is the only record of it once the transfer happens, so " +
        "never skip it, even for a caller who wants to be connected immediately. Once " +
        "take_message has been called, let the caller know you're connecting them now.",
      allowed_tools: ["take_message"],
      is_terminal: false,
    },
    {
      id: "transfer_to_human_connect",
      name: "Transfer to human (connect)",
      prompt_fragment:
        "The intake message has been recorded — now connect the caller. " +
        WARM_TRANSFER_FRAGMENT +
        " Use transfer_call.",
      allowed_tools: ["transfer_call"],
      is_terminal: true,
    },
  ];
}

/**
 * GAP_REGISTER.md §2 Legal item 4: `matter_type`/`opposing_party`/
 * `urgency`/`referral_source` have no typed destination on `take_message`
 * today — `zTakeMessageRequest` (`@heyloo/canonical-types`) only has
 * `caller_name`/`caller_phone`/`message_text`/`callback_window`, unlike
 * `create_booking`'s typed `structured_payload` (`zLegalBookingPayload`,
 * `booking-payloads.ts`, which already declares exactly these 5 fields —
 * apparently anticipating a typed `structured_payload` on `take_message`
 * too). Extending that schema is outside this cluster's ownership
 * (`packages/canonical-types`, `packages/templates/src/shared/tools.ts`)
 * — filed in `docs/audit/FIX_REQUESTS.md`. Until it lands, this fragment
 * closes the gap the only way available from inside this cluster's
 * ownership: instructing the model to compose `message_text` with fixed,
 * labeled lines so every field is still recoverable (never silently
 * dropped) even though it isn't yet a separate structured column.
 */
const STRUCTURED_INTAKE_CAPTURE_FRAGMENT =
  "Whenever you call take_message — whether the intake finished normally or you're ending the " +
  "call early — compose message_text as these exact labeled lines, one per line, using " +
  '"not yet asked" for anything you never got to (never omit a label): "Matter type: ...", ' +
  '"Opposing party (conflict check — needs human confirmation, never say it has already ' +
  'cleared): ...", "Urgency: standard or urgent — ...", "Referral source: ...", followed by a ' +
  "plain-language summary of what the caller described in open discovery. This keeps the " +
  "conflict-check answer and everything else gathered recoverable even on an early exit. " +
  "ALSO pass the same values on the structured_payload argument of that same take_message " +
  'call: matter_type, opposing_party, referral_source, and urgency ("standard" or ' +
  '"urgent"), using only whatever you actually gathered this call — omit a key entirely ' +
  "rather than guessing. Never set conflict_check_cleared yourself; whether a conflict check " +
  "has cleared is always decided by a human at the firm, never by you, so leave that key out " +
  "even when you have the opposing party's name.";

/**
 * CALL-8 (docs/BUILD_PLAN.md): live-observed real bug — the caller often
 * volunteers urgency/referral-source information ahead of schedule (during
 * `matter_type`/`conflict_check`/`open_discovery`, before the state graph
 * ever reaches the dedicated `urgency`/`referral_source` states), and the
 * model, believing intake is functionally complete, thanks the caller and
 * calls `end_call` directly from whichever state it's currently in —
 * WITHOUT ever transitioning to `intake_complete`, the only state
 * `allowed_tools` originally granted `take_message` on. Since `take_message`
 * wasn't even a callable tool in the model's current state, the intake was
 * silently lost even though Retell's own transcript-relevance judge still
 * scored the call "pass" (it never checks whether a tool call happened,
 * only whether replies stayed on topic). Fixed at the root: `take_message`
 * is now granted on every state from `matter_type` onward (not just
 * `intake_complete`), and this fragment — appended to each of those
 * states' own prompt — tells the model explicitly it can and must call it
 * from wherever it currently is if it's about to end the call early,
 * rather than only being ABLE to record from the one state it may never
 * actually reach.
 */
const EARLY_WRAP_UP_FRAGMENT =
  "If the caller seems ready to end the call, or you're about to say goodbye, BEFORE any of " +
  "that: call take_message right now with whatever intake you've gathered so far, even if " +
  "it's incomplete — you do not need to wait until every question above has been asked. " +
  "Never end the call having promised the firm will follow up without actually calling " +
  "take_message first.";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are an intake assistant for a law firm. Your job is to gather intake information " +
    "warmly and thoroughly so an attorney can follow up — not to practice law yourself. " +
    "This firm handles {{practice_areas}}; if a caller's matter is outside that list, say so " +
    "honestly and still offer to take a message.",
  STRUCTURED_INTAKE_CAPTURE_FRAGMENT,
);

const NO_ADVICE_GUARDRAIL =
  "Hard guardrail — true in this state and every other state in this call, with no " +
  "exceptions: never give legal advice, never offer an opinion on the merits or likely " +
  "outcome of the caller's case, and never quote a fee beyond the configured consult fee " +
  "({{consult_fee_text}}). If pressed, say only that an attorney will review the details and " +
  "follow up — never improvise around this rule.";

/**
 * Applied to EVERY state in this template (including the shared transfer/
 * solicitor/emergency ones) so the guardrail and its `legal_advice_given`
 * extraction field are structurally present everywhere, not just on the
 * states authored specifically for this vertical.
 */
function withLegalGuardrail(state: AgentState): AgentState {
  return {
    ...state,
    prompt_fragment: `${state.prompt_fragment}\n\n${NO_ADVICE_GUARDRAIL}`,
    extraction: [...(state.extraction ?? []), { field: "legal_advice_given", type: "boolean" }],
  };
}

const rawStates: AgentState[] = [
  {
    id: "greeting",
    name: "Greeting",
    prompt_fragment: "Greet the caller and ask what brings them in today.",
    allowed_tools: [],
  },
  {
    id: "collect_name_phone",
    name: "Collect name + phone",
    prompt_fragment:
      "Ask for the caller's full name, then their phone number, confirming each. You may call " +
      "lookup_customer with the number they're calling from to check whether they're an " +
      "existing client — if so, greet them as a returning client, but still complete the rest " +
      "of intake in full (a prior relationship never skips the conflict check).",
    allowed_tools: ["lookup_customer"],
  },
  {
    id: "matter_type",
    name: "Matter type",
    prompt_fragment:
      "Ask what type of legal matter this is, guiding toward one of {{practice_areas}} if it " +
      "fits. " +
      EARLY_WRAP_UP_FRAGMENT,
    allowed_tools: ["take_message"],
    extraction: [
      {
        field: "matter_type",
        type: "text",
        description:
          "The type of legal matter the caller described (e.g. one of the firm's configured " +
          "practice areas, or their own words if it doesn't fit one).",
      },
    ],
  },
  {
    id: "conflict_check",
    name: "Conflict check (BEFORE any substantive discussion)",
    prompt_fragment:
      "Before discussing any details of the matter itself, ask for the opposing party's full " +
      "name (and their attorney's name/firm, if the caller knows it) — this happens BEFORE the " +
      "open-discovery conversation, every time, no exceptions. This is a conflict-of-interest " +
      "check: record what the caller says and let them know the firm will confirm there's no " +
      "conflict before anything proceeds. Never tell the caller a conflict check has 'passed' " +
      "or 'cleared' — that determination is always made by a human at the firm, never by you. " +
      EARLY_WRAP_UP_FRAGMENT,
    allowed_tools: ["take_message"],
  },
  {
    id: "open_discovery",
    name: "Open discovery",
    prompt_fragment:
      'Now invite the caller to explain, in their own words: "Walk me through what happened." ' +
      "Listen and ask open, empathetic follow-up questions without steering them or evaluating " +
      "what they say. " +
      EARLY_WRAP_UP_FRAGMENT,
    allowed_tools: ["take_message"],
  },
  {
    id: "urgency",
    name: "Urgency check",
    prompt_fragment:
      "Ask about anything time-sensitive: a statute-of-limitations concern, a custody " +
      "situation, or an upcoming court date. Flag anything urgent for the attorney clearly in " +
      "the message. " +
      EARLY_WRAP_UP_FRAGMENT,
    allowed_tools: ["take_message"],
    extraction: [
      {
        field: "urgency",
        type: "enum",
        enum_values: ["standard", "urgent"],
        description:
          '"urgent" if the caller described anything time-sensitive — a statute-of-' +
          "limitations concern, a custody situation, an upcoming court date, or similar — " +
          '"standard" otherwise.',
      },
    ],
  },
  {
    id: "referral_source",
    name: "Referral source",
    prompt_fragment: `Ask how the caller heard about this firm. ${EARLY_WRAP_UP_FRAGMENT}`,
    allowed_tools: ["take_message"],
    extraction: [
      {
        field: "referral_source",
        type: "text",
        description: "How the caller said they heard about this firm.",
      },
    ],
  },
  {
    id: "intake_complete",
    name: "Intake complete",
    prompt_fragment:
      "Before recording anything, read back what you have — the caller's name and phone, the " +
      "matter type, the opposing party you'll run a conflict check on, the urgency, and a " +
      "one-line summary of what they described — and get an explicit yes that it's correct, " +
      "the same way every other vertical confirms a booking before finalizing it. Then thank " +
      "the caller, let them know an attorney will review the intake (including the conflict " +
      "check) and follow up, and record the full intake as a message for the firm.",
    allowed_tools: ["take_message"],
    is_terminal: true,
  },
  ...legalTransferToHumanStates(),
  solicitorDeflectState(),
  safetyEmergencyState(),
  takeMessageFallbackState(),
];

export const LEGAL_TEMPLATE: AgentTemplate = {
  vertical: "legal",
  compile_target: "multi_prompt",
  system_prompt: SYSTEM_PROMPT,
  states: rawStates.map(withLegalGuardrail).map(withCallOutcomeExtraction),
  transitions: [
    { from: "greeting", to: "collect_name_phone", on: { intent: "explains_reason_for_calling" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_wants_to_leave_a_message" },
    },
    { from: "collect_name_phone", to: "matter_type", on: { intent: "name_phone_confirmed" } },
    { from: "matter_type", to: "conflict_check", on: { intent: "matter_type_identified" } },
    {
      from: "conflict_check",
      to: "open_discovery",
      on: { intent: "opposing_party_recorded" },
    },
    { from: "open_discovery", to: "urgency", on: { intent: "discovery_complete" } },
    { from: "urgency", to: "referral_source", on: { intent: "urgency_recorded" } },
    { from: "referral_source", to: "intake_complete", on: { intent: "referral_source_recorded" } },
    {
      from: "transfer_to_human",
      to: "transfer_to_human_connect",
      on: { intent: "message_recorded" },
    },
  ],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
    giveUpGlobalIntent("take_message_fallback"),
  ],
  tools: [lookupCustomerTool(), takeMessageTool("legal"), transferCallTool()],
  disclosure_line: DISCLOSURE_LINE,
};
