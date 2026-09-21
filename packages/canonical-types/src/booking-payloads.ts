/**
 * Per-vertical typed `structured_payload` shapes for `create_booking`
 * (GAP_REGISTER.md §1.7). Every vertical's most information-dense in-call
 * capture (vehicle info, pet species/breed, buyer/seller qualification,
 * room type/rate, matter type) previously had no typed destination —
 * `structured_payload` was `{type: object}` with no `properties` in the
 * JSON Schema sent to Retell, so the model got no authoring hint and
 * `create_booking.ts` had nothing to validate against before insert.
 *
 * Each schema is deliberately a loose, fully-optional object (never
 * `.strict()`): a live call frequently doesn't capture every field (a
 * caller declines to answer, or the state machine takes an early exit via
 * a global intent), and the hot path must never fail a real booking over
 * an incomplete/malformed payload (CLAUDE.md Rule 2: "aggressive timeouts
 * with graceful fallback", not a hard 4xx on the caller's actual booking).
 * `z.looseObject` (not `.strict()`) also means an extra key the model adds
 * is preserved, not silently dropped — "give the model an authoring
 * schema" (better fill rate) without punishing a good-faith extra field.
 *
 * `zBookingStructuredPayloadFor(vertical)` is what `create_booking.ts`
 * actually calls; verticals with no vertical-specific shape yet
 * (`real_estate`, `generic`) fall back to a bare loose object rather than
 * inventing fields no template currently asks for — extending those two is
 * a template-authoring task (GAP_REGISTER.md §1.7's real_estate item),
 * tracked in `docs/BUILD_NOTES.md`, not silently guessed here.
 */

import { z } from "zod";
import { zCents } from "./primitives.js";
import type { Vertical } from "./vertical.js";

export const zAutoBookingPayload = z.looseObject({
  vehicle_year: z.number().int().min(1900).max(2100).optional(),
  vehicle_make: z.string().min(1).optional(),
  vehicle_model: z.string().min(1).optional(),
  symptom_category: z.string().min(1).optional(),
  drop_off_or_wait: z.enum(["drop_off", "wait"]).optional(),
});
export type AutoBookingPayload = z.infer<typeof zAutoBookingPayload>;

export const zVetBookingPayload = z.looseObject({
  pet_name: z.string().min(1).optional(),
  species: z.string().min(1).optional(),
  breed: z.string().min(1).optional(),
  age_years: z.number().min(0).max(100).optional(),
  visit_reason: z.string().min(1).optional(),
  symptom_or_routine: z.enum(["symptom", "routine"]).optional(),
});
export type VetBookingPayload = z.infer<typeof zVetBookingPayload>;

export const zLegalBookingPayload = z.looseObject({
  matter_type: z.string().min(1).optional(),
  opposing_party: z.string().min(1).optional(),
  conflict_check_cleared: z.boolean().optional(),
  referral_source: z.string().min(1).optional(),
  urgency: z.enum(["standard", "urgent"]).optional(),
});
export type LegalBookingPayload = z.infer<typeof zLegalBookingPayload>;

export const zDentalBookingPayload = z.looseObject({
  new_or_existing: z.enum(["new", "existing"]).optional(),
  insurance_provider: z.string().min(1).optional(),
  reason_for_visit: z.string().min(1).optional(),
  pain_level: z.number().int().min(0).max(10).optional(),
});
export type DentalBookingPayload = z.infer<typeof zDentalBookingPayload>;

export const zRealEstateBookingPayload = z.looseObject({
  buyer_or_seller: z.enum(["buyer", "seller"]).optional(),
  area: z.string().min(1).optional(),
  pre_approved: z.boolean().optional(),
  timeline: z.string().min(1).optional(),
  budget_cents: zCents.optional(),
  working_with_another_agent: z.boolean().optional(),
});
export type RealEstateBookingPayload = z.infer<typeof zRealEstateBookingPayload>;

export const zMotelBookingPayload = z.looseObject({
  room_type: z.string().min(1).optional(),
  /** The exact nightly rate quoted to the caller from the tenant's own
   * {{rate_table}} — never model-invented (RATE_DISCIPLINE_FRAGMENT,
   * packages/templates/src/verticals/motel.ts) — also mirrored onto
   * `bookings.quoted_rate_cents` directly (a real column, not just this
   * jsonb blob) so a rate dispute is recoverable without a transcript
   * re-listen (GAP_REGISTER.md §2 Motel item 5). */
  quoted_rate_cents: zCents.optional(),
  num_guests: z.number().int().positive().optional(),
});
export type MotelBookingPayload = z.infer<typeof zMotelBookingPayload>;

export const zRestaurantBookingPayload = z.looseObject({
  allergies: z.array(z.string().min(1)).optional(),
  special_instructions: z.string().min(1).optional(),
  occasion: z.string().min(1).optional(),
});
export type RestaurantBookingPayload = z.infer<typeof zRestaurantBookingPayload>;

/**
 * CALL-8 (docs/BUILD_PLAN.md): `reason` — SYSTEM_DESIGN §4.3's generic
 * input-collection spec ("name · phone · reason · message · callback
 * window") and `_shared/vertical-intake.ts`'s required-field matrix both
 * need somewhere typed to put it; mirrors the Deno-side `_shared/schemas/
 * booking-payloads.ts`'s identical addition.
 */
export const zGenericBookingPayload = z.looseObject({
  reason: z.string().min(1).optional(),
});
export type GenericBookingPayload = z.infer<typeof zGenericBookingPayload>;

export const zBookingStructuredPayload = z.union([
  zAutoBookingPayload,
  zVetBookingPayload,
  zLegalBookingPayload,
  zDentalBookingPayload,
  zRealEstateBookingPayload,
  zMotelBookingPayload,
  zRestaurantBookingPayload,
  zGenericBookingPayload,
]);
export type BookingStructuredPayload = z.infer<typeof zBookingStructuredPayload>;

/** Vertical -> the Zod schema validating that vertical's `create_booking`
 * `structured_payload` (GAP_REGISTER.md §1.7). Every schema here accepts
 * unknown extra keys (`z.looseObject`), so this never rejects a payload
 * outright — it's an authoring/typing aid, not a gate that can fail a real
 * booking. */
export function zBookingStructuredPayloadFor(vertical: string): z.ZodType<Record<string, unknown>> {
  switch (vertical as Vertical) {
    case "auto":
      return zAutoBookingPayload;
    case "vet":
      return zVetBookingPayload;
    case "legal":
      return zLegalBookingPayload;
    case "dental":
      return zDentalBookingPayload;
    case "real_estate":
      return zRealEstateBookingPayload;
    case "motel":
      return zMotelBookingPayload;
    case "restaurant":
      return zRestaurantBookingPayload;
    default:
      return zGenericBookingPayload;
  }
}

/**
 * Per-item JSON-Schema `properties` (draft-07-ish, the subset Retell's tool
 * function-calling shape accepts — see `CanonicalTool["parameters"]` in
 * `agent-template.ts`) for each vertical's `structured_payload`, surfaced
 * to the model so it knows what to fill in (Retell shows tool JSON Schema
 * `properties` to the LLM — GAP_REGISTER.md §1.7's stated motivation).
 * Kept as plain JSON-Schema-shaped object literals (not derived from the
 * Zod schemas above via a schema-to-JSON-Schema converter) since this
 * package has no such dependency and the shapes are small/stable enough to
 * hand-maintain in lockstep — `booking-payloads.test.ts` asserts the key
 * sets match the Zod shapes above so the two can't silently drift.
 */
export const BOOKING_STRUCTURED_PAYLOAD_PROPERTIES: Record<
  Vertical,
  Record<string, { type: string; description?: string; items?: { type: string } }>
> = {
  auto: {
    vehicle_year: { type: "integer" },
    vehicle_make: { type: "string" },
    vehicle_model: { type: "string" },
    symptom_category: { type: "string" },
    drop_off_or_wait: { type: "string", description: "'drop_off' or 'wait'" },
  },
  vet: {
    pet_name: { type: "string" },
    species: { type: "string" },
    breed: { type: "string" },
    age_years: { type: "number" },
    visit_reason: { type: "string" },
    symptom_or_routine: { type: "string", description: "'symptom' or 'routine'" },
  },
  legal: {
    matter_type: { type: "string" },
    opposing_party: { type: "string" },
    conflict_check_cleared: { type: "boolean" },
    referral_source: { type: "string" },
    urgency: { type: "string", description: "'standard' or 'urgent'" },
  },
  dental: {
    new_or_existing: { type: "string", description: "'new' or 'existing'" },
    insurance_provider: { type: "string" },
    reason_for_visit: { type: "string" },
    pain_level: { type: "integer", description: "0-10" },
  },
  real_estate: {
    buyer_or_seller: { type: "string", description: "'buyer' or 'seller'" },
    area: { type: "string" },
    pre_approved: { type: "boolean" },
    timeline: { type: "string" },
    budget_cents: { type: "integer" },
    working_with_another_agent: { type: "boolean" },
  },
  motel: {
    room_type: { type: "string" },
    quoted_rate_cents: {
      type: "integer",
      description: "The exact nightly rate quoted from {{rate_table}} — never invented",
    },
    num_guests: { type: "integer" },
  },
  restaurant: {
    allergies: { type: "array", items: { type: "string" } },
    special_instructions: { type: "string" },
    occasion: { type: "string" },
  },
  generic: {
    reason: {
      type: "string",
      description: "The reason for the call/visit, in the caller's own words.",
    },
  },
};
