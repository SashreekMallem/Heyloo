import type { Vertical } from "./vertical-defaults.ts";

/**
 * CALL-8 (docs/BUILD_PLAN.md): the single source of truth for "what does a
 * real business in this vertical actually need collected — and confirmed
 * back to the caller — before a booking/order/message write completes?"
 * Derived from `docs/SYSTEM_DESIGN.md` §4.3's per-vertical input-collection
 * spec and `docs/VERTICAL_RESEARCH.md`, cross-checked against what each
 * vertical's real template (`packages/templates/src/verticals/*.ts`) already
 * asks for and stores (`_shared/schemas/booking-payloads.ts`'s typed
 * `structured_payload` shapes) — every field below maps to a real argument
 * path a tool already accepts, never an invented one.
 *
 * Used by three consumers, so a field only ever needs to change here once:
 *  1. `voice-tools/handler.ts` — server-side enforcement. After a tool
 *     call's args pass Zod shape validation, `getMissingRequiredFields`
 *     checks this vertical/tool's list; any miss returns a
 *     `missingFieldsEnvelope` (`_shared/responses.ts`) naming EXACTLY what
 *     to ask, instead of writing an incomplete row.
 *  2. `agent-template-seeds.ts` / `packages/templates/src/verticals/*.ts` —
 *     the prompt fragments that instruct the model to collect and read back
 *     these same fields (hand-authored prose, not a runtime import — a
 *     compiled agent prompt is a static string — but every field named here
 *     has a matching "ask for X" / "read back X" instruction there).
 *  3. `api-admin-run-agent-tests/handler.ts` (via `test-scenarios.ts`'s
 *     `writeIntent`) — after a batch-test scenario settles, the harness
 *     looks up the DB row the scenario's tool call produced and checks
 *     every one of these fields is actually present, reporting per-field
 *     capture rather than only Retell's own transcript-based pass/fail.
 *
 * Two DELIBERATE deviations from a naive reading of the task's own example
 * matrix, both documented per CLAUDE.md Rule 4 (conflict with
 * SYSTEM_DESIGN — follow the documented decision, note it, proceed):
 *
 *  - `dental` does NOT require insurance. `docs/SYSTEM_DESIGN.md` §4.3 and
 *    `packages/templates/src/verticals/dental.ts`'s own `PHI_DEFERRAL_FRAGMENT`
 *    deliberately instruct the model to NEVER ask for insurance (or DOB/SSN)
 *    over the phone — those are collected later through a secure post-call
 *    form link specifically so PHI stays out of the call transcript.
 *    Requiring insurance here would force the agent to violate that
 *    documented PHI-avoidance design. `new_or_existing` + `reason_for_visit`
 *    are required instead — the two dental-specific fields SYSTEM_DESIGN
 *    actually does ask the call to capture.
 *  - `restaurant`'s `create_order` intent does not require a "pickup time"
 *    field — no such field exists anywhere in `orders`/`create_order`
 *    today (checked: `_shared/schemas/voice-tools.ts`, the `orders` table
 *    migration) and most phone pickup orders are implicitly ASAP. Adding a
 *    real column/argument for it is a genuine, reasonable follow-up but a
 *    schema-widening task of its own scope, not a required-field gate over
 *    an argument that doesn't exist yet — flagged in `docs/BUILD_NOTES.md`,
 *    not silently invented here.
 */

export type WriteTool = "create_booking" | "create_order" | "take_message";

export interface RequiredIntakeField {
  /** Dot path into the tool's (already Zod-shape-validated, phone-defaulted)
   * args object — e.g. `"customer.name"`, `"structured_payload.pet_name"`. */
  path: string;
  /** Plain-English phrase a missing-fields tool error tells the agent to
   * ask the caller for next. */
  askFor: string;
}

export interface VerticalIntakeSpec {
  create_booking?: RequiredIntakeField[];
  create_order?: RequiredIntakeField[];
  /** Every vertical takes messages (after-hours/fallback intake at minimum),
   * so this is always present — the universal baseline below, optionally
   * overlaid with vertical-specific fields for a vertical whose OWN
   * template routes its primary intake through `take_message` rather than
   * `create_booking` (today: `legal`, and `real_estate`'s no-showing-yet
   * lead path — see each vertical's own template for why). */
  take_message: RequiredIntakeField[];
}

const CORE_BOOKING_FIELDS: RequiredIntakeField[] = [
  { path: "customer.name", askFor: "the caller's full name" },
  { path: "customer.phone", askFor: "a callback phone number" },
  { path: "start", askFor: "the requested appointment date/time" },
  { path: "end", askFor: "the requested appointment date/time" },
];

const MESSAGE_BASELINE: RequiredIntakeField[] = [
  { path: "caller_name", askFor: "the caller's full name" },
  { path: "caller_phone", askFor: "a callback phone number" },
  { path: "message_text", askFor: "a short description of what the call is about" },
];

export const REQUIRED_INTAKE_FIELDS: Record<Vertical, VerticalIntakeSpec> = {
  auto: {
    create_booking: [
      ...CORE_BOOKING_FIELDS,
      { path: "structured_payload.vehicle_year", askFor: "the vehicle's model year" },
      { path: "structured_payload.vehicle_make", askFor: "the vehicle's make" },
      { path: "structured_payload.vehicle_model", askFor: "the vehicle's model" },
      { path: "structured_payload.symptom_category", askFor: "what service the vehicle needs" },
    ],
    take_message: MESSAGE_BASELINE,
  },
  vet: {
    create_booking: [
      ...CORE_BOOKING_FIELDS,
      { path: "structured_payload.pet_name", askFor: "the pet's name" },
      { path: "structured_payload.species", askFor: "the pet's species" },
      { path: "structured_payload.visit_reason", askFor: "the reason for the visit" },
    ],
    take_message: MESSAGE_BASELINE,
  },
  legal: {
    // Legal's own template (`packages/templates/src/verticals/legal.ts`)
    // never calls create_booking at all — `take_message` IS its primary
    // intake-completion tool (`intake_complete` state), not just an
    // after-hours fallback, so the vertical-specific overlay goes here.
    take_message: [
      ...MESSAGE_BASELINE,
      { path: "structured_payload.matter_type", askFor: "the type of legal matter" },
      {
        path: "structured_payload.opposing_party",
        askFor: "the opposing party's full name (for the conflict check)",
      },
      { path: "structured_payload.urgency", askFor: "whether anything is time-sensitive" },
    ],
  },
  dental: {
    create_booking: [
      ...CORE_BOOKING_FIELDS,
      {
        path: "structured_payload.new_or_existing",
        askFor: "whether they're a new or existing patient",
      },
      { path: "structured_payload.reason_for_visit", askFor: "the reason for the visit" },
    ],
    take_message: MESSAGE_BASELINE,
  },
  real_estate: {
    create_booking: [
      ...CORE_BOOKING_FIELDS,
      { path: "structured_payload.buyer_or_seller", askFor: "whether they're buying or selling" },
      { path: "structured_payload.area", askFor: "the property or area they're interested in" },
      { path: "structured_payload.timeline", askFor: "their timeline" },
    ],
    // real_estate's "lead_only" state (no showing booked yet) is its OWN
    // primary capture path for a valuation/quote lead — same overlay
    // reasoning as legal, one field narrower (timeline is asked but a lead
    // who "just wants a rough number" may not have one yet, unlike a
    // showing they're actively scheduling).
    take_message: [
      ...MESSAGE_BASELINE,
      { path: "structured_payload.buyer_or_seller", askFor: "whether they're buying or selling" },
      { path: "structured_payload.area", askFor: "the property or area they're interested in" },
    ],
  },
  motel: {
    create_booking: [
      ...CORE_BOOKING_FIELDS,
      { path: "structured_payload.num_guests", askFor: "how many guests" },
      { path: "structured_payload.room_type", askFor: "which room type" },
    ],
    take_message: MESSAGE_BASELINE,
  },
  restaurant: {
    create_booking: [...CORE_BOOKING_FIELDS, { path: "party_size", askFor: "the party size" }],
    create_order: [
      { path: "customer.name", askFor: "the caller's full name" },
      { path: "customer.phone", askFor: "a callback phone number" },
    ],
    take_message: MESSAGE_BASELINE,
  },
  generic: {
    create_booking: [
      ...CORE_BOOKING_FIELDS,
      { path: "structured_payload.reason", askFor: "the reason for the call" },
    ],
    take_message: MESSAGE_BASELINE,
  },
};

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Returns every required field this vertical/tool call is missing — `[]`
 * when nothing is missing (the common case, zero-cost beyond the field
 * walk: no DB round trip, safe for the hot path). Silently returns `[]` for
 * a tool this vertical has no requirements list for (e.g. `create_order` on
 * a non-restaurant vertical) rather than throwing — callers only ever pass
 * a (vertical, tool) pair a real template actually grants.
 */
export function getMissingRequiredFields(
  vertical: string,
  tool: WriteTool,
  args: Record<string, unknown>,
): RequiredIntakeField[] {
  const spec = REQUIRED_INTAKE_FIELDS[vertical as Vertical];
  const fields = spec?.[tool];
  if (!fields) return [];
  return fields.filter((f) => !isPresent(getPath(args, f.path)));
}
