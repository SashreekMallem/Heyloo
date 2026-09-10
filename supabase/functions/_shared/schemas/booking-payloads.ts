import { z } from "zod";

/**
 * Deno-side mirror of `packages/canonical-types/src/booking-payloads.ts`
 * (GAP_REGISTER.md §1.7 / FIX-1 follow-up) — field-for-field identical to
 * that package's per-vertical loose Zod schemas, kept here since Deno
 * (`supabase/functions/deno.json`, this file's real runtime) cannot import
 * the Node/ESM `@heyloo/canonical-types` package directly (same documented
 * constraint as `admin/schemas.ts` and `create_booking.ts`'s own
 * `extractMetadataMerge`). This is the schema `create_booking.ts` actually
 * calls `.safeParse()`/per-field-sanitize against before persisting
 * `structured_payload` — closing the gap where the canonical union existed
 * but nothing on the runtime hot path ever validated against it.
 *
 * Every schema stays a loose, fully-optional object (never `.strict()`):
 * a live call frequently doesn't capture every field, and the hot path
 * must never fail a real booking over an incomplete/malformed payload
 * (CLAUDE.md Rule 2 graceful fallback). `zBookingStructuredPayloadFor`
 * mirrors the canonical package's own fallback for `real_estate`/`generic`
 * (no vertical-specific shape yet) to a bare loose object.
 */

export const zAutoBookingPayload = z.looseObject({
  vehicle_year: z.number().int().min(1900).max(2100).optional(),
  vehicle_make: z.string().min(1).optional(),
  vehicle_model: z.string().min(1).optional(),
  symptom_category: z.string().min(1).optional(),
  drop_off_or_wait: z.enum(["drop_off", "wait"]).optional(),
});

export const zVetBookingPayload = z.looseObject({
  pet_name: z.string().min(1).optional(),
  species: z.string().min(1).optional(),
  breed: z.string().min(1).optional(),
  age_years: z.number().min(0).max(100).optional(),
  visit_reason: z.string().min(1).optional(),
  symptom_or_routine: z.enum(["symptom", "routine"]).optional(),
});

export const zLegalBookingPayload = z.looseObject({
  matter_type: z.string().min(1).optional(),
  opposing_party: z.string().min(1).optional(),
  conflict_check_cleared: z.boolean().optional(),
  referral_source: z.string().min(1).optional(),
  urgency: z.enum(["standard", "urgent"]).optional(),
});

export const zDentalBookingPayload = z.looseObject({
  new_or_existing: z.enum(["new", "existing"]).optional(),
  insurance_provider: z.string().min(1).optional(),
  reason_for_visit: z.string().min(1).optional(),
  pain_level: z.number().int().min(0).max(10).optional(),
});

export const zRealEstateBookingPayload = z.looseObject({
  buyer_or_seller: z.enum(["buyer", "seller"]).optional(),
  area: z.string().min(1).optional(),
  pre_approved: z.boolean().optional(),
  timeline: z.string().min(1).optional(),
  budget_cents: z.number().int().nonnegative().optional(),
  working_with_another_agent: z.boolean().optional(),
});

export const zMotelBookingPayload = z.looseObject({
  room_type: z.string().min(1).optional(),
  quoted_rate_cents: z.number().int().nonnegative().optional(),
  num_guests: z.number().int().positive().optional(),
});

export const zRestaurantBookingPayload = z.looseObject({
  allergies: z.array(z.string().min(1)).optional(),
  special_instructions: z.string().min(1).optional(),
  occasion: z.string().min(1).optional(),
});

export const zGenericBookingPayload = z.looseObject({});

const BOOKING_PAYLOAD_SCHEMA_BY_VERTICAL = {
  auto: zAutoBookingPayload,
  vet: zVetBookingPayload,
  legal: zLegalBookingPayload,
  dental: zDentalBookingPayload,
  real_estate: zRealEstateBookingPayload,
  motel: zMotelBookingPayload,
  restaurant: zRestaurantBookingPayload,
  generic: zGenericBookingPayload,
} satisfies Record<string, z.ZodObject>;

export function zBookingStructuredPayloadFor(vertical: string): z.ZodObject {
  return (
    BOOKING_PAYLOAD_SCHEMA_BY_VERTICAL[
      vertical as keyof typeof BOOKING_PAYLOAD_SCHEMA_BY_VERTICAL
    ] ?? zGenericBookingPayload
  );
}

/**
 * Per-field sanitize, never a hard gate (CLAUDE.md Rule 2 hot-path
 * discipline — a malformed field must never fail a real booking). Any
 * known field of this vertical's schema whose value fails that field's own
 * validator is dropped; unrecognized keys are preserved untouched (loose-
 * object authoring-aid semantics, same posture as the Zod schemas
 * themselves). This is what actually runs on `create_booking`'s hot path —
 * `zBookingStructuredPayloadFor` alone was previously only used to build
 * the JSON-Schema authoring hint shown to the model, never to validate.
 */
export function sanitizeBookingStructuredPayload(
  vertical: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const schema = zBookingStructuredPayloadFor(vertical);
  const shape: Record<string, z.ZodType> = schema.shape;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const fieldSchema = shape[key];
    if (!fieldSchema) {
      sanitized[key] = value;
      continue;
    }
    const parsed = fieldSchema.safeParse(value);
    if (parsed.success) {
      sanitized[key] = parsed.data;
    }
  }
  return sanitized;
}
