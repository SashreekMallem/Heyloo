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
import { CONTACT_DETAILS, WARM_TRANSFER_FRAGMENT } from "../shared/fragments.js";
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
        'even if it\'s incomplete: set structured_payload.intake_status to "partial" and ' +
        "omit every structured field you don't have (never invent one). This is the only " +
        "record of it once the transfer happens, so never skip it, even for a caller who " +
        "wants to be connected immediately, and never keep them waiting or ask them intake " +
        "questions they refuse. Once take_message has been called (if it answers with an " +
        "error, call it once more as partial), move on to connecting them — but never tell the caller " +
        "yourself that you are connecting or transferring them: a real transfer announces " +
        "itself, and if no live line is available the next step says so honestly.",
      allowed_tools: ["take_message"],
      is_terminal: false,
    },
    {
      id: "transfer_to_human_connect",
      name: "Transfer to human (connect)",
      prompt_fragment:
        "The intake message has been recorded — now connect the caller if a live line is " +
        "available. " +
        WARM_TRANSFER_FRAGMENT +
        " Never tell the caller yourself that you are connecting them — transfer_call " +
        "announces the connection itself; if no live line is available, say so honestly and " +
        "let them know an attorney will call them back.",
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
  '"Not yet asked" belongs only in message_text: when the intake is incomplete, omit the ' +
  'structured keys you do not have and set structured_payload.intake_status to "partial". ' +
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
  'it\'s incomplete (set structured_payload.intake_status to "partial") — you do not need ' +
  "to wait until every question above has been asked. " +
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
    prompt_fragment:
      "The caller has already been greeted by your opening line. Find out what brings them " +
      "in today.",
    allowed_tools: [],
  },
  {
    id: "intake",
    name: "Intake (conflict check BEFORE any substantive discussion)",
    prompt_fragment:
      "Gather the intake, taking whatever the caller already said and asking only for what's " +
      "missing: " +
      CONTACT_DETAILS +
      " (you may call lookup_customer with no arguments to see if they're an existing " +
      "client — a prior relationship never skips the conflict check); the type of legal " +
      "matter, guided toward one of {{practice_areas}} if it fits; then — BEFORE discussing " +
      "any details of the matter, every time, no exceptions — the opposing party's full name " +
      "(and their attorney or firm, if known). That is a conflict-of-interest check: record it " +
      "and let them know the firm will confirm there's no conflict before anything proceeds; " +
      "never say a conflict check has passed or cleared — a human at the firm decides that. " +
      'Then invite a short account in their own words ("Briefly, what happened?") and listen ' +
      "without steering or evaluating — a few sentences is enough, the attorney will go " +
      "through the details; ask at most one or two follow-ups. Find out whether anything is " +
      "time-sensitive (a statute-of-limitations concern, a custody situation, an upcoming " +
      "court date) unless they already said, and flag anything urgent clearly; and how they " +
      "heard about the firm. " +
      EARLY_WRAP_UP_FRAGMENT,
    allowed_tools: ["lookup_customer", "take_message"],
    extraction: [
      {
        field: "matter_type",
        type: "text",
        description:
          "The type of legal matter the caller described (e.g. one of the firm's configured " +
          "practice areas, or their own words if it doesn't fit one).",
      },
      {
        field: "urgency",
        type: "enum",
        enum_values: ["standard", "urgent"],
        description:
          '"urgent" if the caller described anything time-sensitive — a statute-of-' +
          "limitations concern, a custody situation, an upcoming court date, or similar — " +
          '"standard" otherwise.',
      },
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
      "Before recording anything, read back what you have in one or two sentences — the " +
      "caller's name, the matter type, the opposing party you'll run a conflict check on, " +
      "the urgency, and a one-line summary of what they described — and get an explicit yes " +
      "that it's correct. Then record the full intake as a message for the firm and, once it " +
      "returns recorded:true, tell them in one sentence that an attorney will review it " +
      "(including the conflict check) and follow up. This is a " +
      "request, not a confirmed appointment: say the firm will call to confirm a time, never " +
      "say a consultation is booked, scheduled or confirmed, and do not read out a " +
      "cancellation policy or offer to cancel or reschedule. If the caller named a preferred " +
      "time, put it in structured_payload.requested_time.",
    allowed_tools: ["take_message"],
    is_terminal: true,
  },
  {
    id: "cancel_or_reschedule_request",
    name: "Cancel or reschedule request",
    prompt_fragment:
      "The caller wants to cancel or reschedule an existing consultation or appointment. " +
      "This firm cannot change an appointment on this call: never say anything is cancelled, " +
      "rescheduled or confirmed, and do not ask the intake or conflict-check questions " +
      "(matter type, opposing party). Get the caller's name, confirm the number they are " +
      "calling from, and which appointment (day and time). Read it back, get a yes, then " +
      'call take_message with structured_payload.intake_status "partial" and ' +
      'structured_payload.request_type "cancellation" or "reschedule" (message_text starting ' +
      '"Cancellation request:" or "Reschedule request:"). Only after it returns ' +
      'recorded:true say: "I have passed your request to the firm; they will confirm it with ' +
      'you." Never use the words cancelled or confirmed for the appointment itself.',
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
    { from: "greeting", to: "intake", on: { intent: "explains_reason_for_calling" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_wants_to_leave_a_message" },
    },
    {
      from: "greeting",
      to: "cancel_or_reschedule_request",
      on: { intent: "wants_to_cancel_or_reschedule" },
    },
    { from: "intake", to: "intake_complete", on: { intent: "intake_details_complete" } },
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
