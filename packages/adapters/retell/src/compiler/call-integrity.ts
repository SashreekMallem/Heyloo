import { type ToolParameters, withCustomAnswersParameter } from "./custom-answers.js";

/**
 * BEHAVIOR-voice-agent (docs/BUILD_NOTES.md): compiler-owned behaviour rules
 * that every compile target shares, kept in PARITY with the live Deno compiler
 * (`supabase/functions/_shared/compiler/template-compiler.ts`, same names).
 * `parity.test.ts` compares the text and the emitted tool schemas.
 *
 * Why the compiler and not each vertical template: the live QA rounds found
 * the same failures in every vertical (an agent saying a message was taken
 * without calling take_message, inventing appointment lookups, stating times
 * without an offset), and the deployed template rows are a hand-synced copy of
 * the sources, so a rule written once here reaches all eight verticals and all
 * three compile targets on the next publish (`AGENT_COMPILER_VERSION` 3).
 */

/**
 * The rules block, spliced into `OWNER_INFO_INSTRUCTIONS` OUTSIDE the owner-data
 * fence (owner text can never override it). Every rule is a behaviour the live
 * calls got wrong (finding ids in docs/BUILD_NOTES.md, BEHAVIOR-voice-agent).
 */
export const CALL_INTEGRITY_INSTRUCTIONS =
  "Call integrity rules (always in force):\n" +
  "- Messages: never say a message was taken, saved or passed along unless take_message " +
  "returned recorded:true in this call. To take one: get the name, callback number and " +
  "message, read them back, get a yes, then call take_message. If it says NOT saved, say so " +
  "and try once more. If details are missing, or you are about to transfer the caller, still " +
  'call it with structured_payload.intake_status "partial" (never invent values). Never ' +
  "promise a callback time.\n" +
  "- Lookups: never say a caller has or lacks an appointment, order or account without a tool " +
  "result in this call; with no tool for it (for example food orders), say so and take a " +
  "message.\n" +
  "- Availability: never say a date, time or room is open before check_availability returned it.\n" +
  "- Times: speak local time; send tools ISO 8601 with the business's UTC offset (for example " +
  "2026-09-30T09:00:00-05:00). Read back a booking's exact local date, time and service and " +
  "get a yes before changing or cancelling it.\n" +
  "- Speech: never say bracketed stage directions such as [Checking...].\n" +
  "- Facts: only mention names, pets, vehicles or addresses the caller said or a tool " +
  "returned; prompt examples are placeholders.\n" +
  "- Fees: never say there is or is not a cancellation fee beyond the policy text.\n";

const OFFSET_HINT =
  "ISO 8601 with the business's UTC offset, for example 2026-09-30T09:00:00-05:00 (never " +
  "without an offset)";

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

/** `parameters` with `properties[path[0]].properties[path[1]]...` shallow-merged with `patch`; unchanged when the property does not exist. */
function patchProperty(parameters: Json, path: string[], patch: Json): Json {
  const [head, ...rest] = path;
  if (head === undefined) return parameters;
  const properties = obj(parameters["properties"]);
  const existing = properties[head];
  if (existing === undefined) return parameters;
  const next =
    rest.length === 0 ? { ...obj(existing), ...patch } : patchProperty(obj(existing), rest, patch);
  return { ...parameters, properties: { ...properties, [head]: next } };
}

function withoutRequired(parameters: Json, names: string[]): Json {
  const required = parameters["required"];
  if (!Array.isArray(required)) return parameters;
  return { ...parameters, required: required.filter((r) => !names.includes(String(r))) };
}

/**
 * Compile-time guidance added to a tool's description and parameters (the model
 * reads both): the offset every time argument must carry, that take_message may
 * be partial and is only proven by `recorded:true`, the fixed SMS template keys.
 * Applied at compile time, like `withCustomAnswersParameter`, so already-seeded
 * `agent_templates` rows need no reseed. Unknown tools pass through unchanged.
 */
export function withToolGuidance<P extends object>(
  toolName: string,
  description: string,
  parameters: P,
): { description: string; parameters: P } {
  let params = parameters as Json;
  let text = description;
  switch (toolName) {
    case "check_availability":
      params = patchProperty(params, ["date_range", "start"], { description: OFFSET_HINT });
      params = patchProperty(params, ["date_range", "end"], { description: OFFSET_HINT });
      break;
    case "create_booking":
      params = patchProperty(params, ["start"], { description: OFFSET_HINT });
      params = patchProperty(params, ["end"], { description: OFFSET_HINT });
      params = patchProperty(params, ["offering_id"], {
        description:
          "The id of the matched offering from list_offerings (never invented); required when " +
          "list_offerings was called this call.",
      });
      break;
    case "update_booking":
      text +=
        " Call check_availability for the new time first and read the exact new local date and " +
        "time back to the caller before calling this. The booking keeps its original length.";
      params = patchProperty(params, ["new_start"], { description: OFFSET_HINT });
      params = patchProperty(params, ["new_end"], {
        description: "Optional: omit it. The booking keeps its original length.",
      });
      params = withoutRequired(params, ["new_end"]);
      break;
    case "join_waitlist":
      params = patchProperty(params, ["preferred_window_start"], { description: OFFSET_HINT });
      params = patchProperty(params, ["preferred_window_end"], { description: OFFSET_HINT });
      break;
    case "lookup_customer":
      text +=
        " recent_bookings lists only upcoming bookings; speak each booking's start_local (the " +
        "business's local time), never start_at.";
      break;
    case "take_message":
      text +=
        " Call it only after reading the details back and getting a yes. Its result " +
        "recorded:true is the only proof the message is saved: never tell the caller a message " +
        'was taken, recorded or passed along before it returns. Set structured_payload.intake_status to "partial" when ' +
        "the caller cannot or will not give every detail, when they only want to cancel or " +
        "reschedule, or right before you transfer them.";
      params = withoutRequired(params, ["caller_phone"]);
      params = patchProperty(params, ["structured_payload"], {
        properties: {
          ...obj(obj(obj(params["properties"])["structured_payload"])["properties"]),
          intake_status: {
            type: "string",
            enum: ["complete", "partial"],
            description:
              '"partial" when the caller cannot or will not give every detail, only wants to ' +
              "cancel or reschedule, or you are about to transfer them; a partial message is " +
              "still stored.",
          },
        },
      });
      break;
    case "send_sms_confirmation":
      text +=
        " Call it only after create_booking or create_order has returned, with that result's id.";
      params = patchProperty(params, ["template_key"], {
        enum: ["booking_confirmation", "order_confirmation", "booking_cancelled"],
        description:
          "booking_confirmation for a booking, order_confirmation for an order, " +
          "booking_cancelled after a cancellation.",
      });
      break;
    default:
      break;
  }
  return { description: text, parameters: params as unknown as P };
}

/**
 * The `description` and `parameters` every compile target emits for a custom
 * (`/voice-tools`) tool: the template's own, plus the compile-time guidance
 * above, plus the owner's custom-answers parameter. One definition so the
 * conversation-flow, multi-prompt and single-prompt targets cannot drift.
 */
export function customToolFields(tool: {
  name: string;
  description: string;
  parameters: { properties?: Record<string, unknown> | undefined; required?: string[] | undefined };
}): { description: string; parameters: ToolParameters } {
  const base: ToolParameters = {
    type: "object",
    properties: tool.parameters.properties ?? {},
    ...(tool.parameters.required !== undefined ? { required: tool.parameters.required } : {}),
  };
  const guided = withToolGuidance(tool.name, tool.description, base);
  return {
    description: guided.description,
    parameters: withCustomAnswersParameter(tool.name, guided.parameters),
  };
}

// ---------------------------------------------------------------------
// Conversation-flow structure (F-DENTAL-MSG-1, VCC-1, VCC-4, F3, F-VET-EMERG-1, VCC-5)
// ---------------------------------------------------------------------

/** The tools that write or change a booking or order: a node holding one may also take a message (Manual Mode, a slot that just filled, a refused write). */
export const WRITE_TOOL_NAMES_FOR_MESSAGE: ReadonlySet<string> = new Set([
  "create_booking",
  "update_booking",
  "cancel_booking",
  "create_order",
]);

/**
 * Templates author transition conditions as bare slugs; Retell's model judges
 * them literally, so an ambiguous slug is only taken when the caller happens
 * to say something close to it. These are the slugs whose bare form misrouted
 * live calls (an appointment-status question that never left the greeting, a
 * vet caller who asked to be connected and was refused). Any other slug is
 * passed through unchanged.
 */
const EDGE_CONDITION_TEXT: Readonly<Record<string, string>> = {
  wants_to_reschedule_or_cancel:
    "The caller wants to reschedule or cancel an appointment, or asks about, checks on or " +
    'wants to confirm an existing appointment or booking (for example "do I have an ' +
    'appointment?" or "what time is mine?")',
  after_hours_or_general_message:
    "The caller wants to leave a message or asks for someone to call them back, or it is after " +
    "hours and they have nothing to book",
  after_hours_or_wants_to_leave_a_message:
    "The caller wants to leave a message or asks for someone to call them back, or it is after " +
    "hours and they have nothing to book",
  caller_wants_direct_transfer:
    "The caller asks to be connected, transferred, or to speak to the clinic, a person or a vet " +
    "directly",
  caller_declines_direct_transfer:
    "The caller does not want to be connected or transferred, or would rather just leave a message",
  wants_to_cancel_or_reschedule:
    "The caller wants to cancel or reschedule an existing consultation or appointment",
  message_recorded:
    "take_message has returned a result (recorded:true), or it has already failed once: do " +
    "not keep the caller waiting, move on now",
};

/** The condition text for a template transition's intent/predicate slug. */
export function edgeConditionText(slug: string): string {
  return EDGE_CONDITION_TEXT[slug] ?? slug;
}

/**
 * VCC-4: the extra exit off a transfer state's no-live-transfer fallback used
 * to be satisfied by the agent merely OFFERING a message, so the flow left the
 * only node holding take_message before the caller answered.
 */
export const FALLBACK_DONE_CONDITION =
  "you have already clearly told the caller you can't connect them to anyone right now " +
  "(restating any emergency referral) AND one of these is true: the caller has declined to " +
  "leave a message or has refused twice, take_message has already returned recorded:true in " +
  "this call, or their message is already with the team. Never take this exit in the same turn " +
  "you first offer to take a message, or while the caller is giving a message you have not " +
  "recorded yet — end here even if the caller keeps repeating the same transfer request";

/** F-DENTAL-MSG-1: exit of a take-a-message state, so the call cannot leave it before take_message has succeeded. */
export const MESSAGE_STATE_EXIT_CONDITION =
  "take_message has returned recorded:true in this call and you have told the caller the team " +
  "will follow up, OR the caller has clearly declined to leave a message. Do NOT take this " +
  "exit while the caller is still giving details, or before take_message has been called and " +
  "has succeeded";

/** True for the states that exist to record a message (`take_message_fallback`, `emergency_take_message`). */
export function isMessageState(state: {
  id: string;
  allowed_tools: readonly string[];
  is_terminal?: boolean | undefined;
}): boolean {
  return (
    state.is_terminal === true &&
    state.allowed_tools.includes("take_message") &&
    /message/.test(state.id)
  );
}

/** F3: appended to the wrap-up global node, which used to absorb a leave-a-message request. */
export const WRAP_UP_NOT_WHILE_MESSAGE =
  " Do NOT use this while the caller is asking to leave a message or is in the middle of " +
  "giving one that take_message has not yet recorded.";

/** F3: the global condition that reaches `take_message_fallback` from anywhere when the template wires no give-up intent to it. */
export const LEAVE_MESSAGE_GLOBAL_CONDITION =
  "The caller explicitly asks to leave a message, or asks for someone to call them back, and " +
  "take_message has not already returned recorded:true in this call";

/** The state every vertical declares for taking a message (`shared/utility-states.ts`). */
export const TAKE_MESSAGE_FALLBACK_STATE_ID = "take_message_fallback";
