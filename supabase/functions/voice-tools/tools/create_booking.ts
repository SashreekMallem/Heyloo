import type { z } from "zod";
import { bookingIdempotencyKey } from "../../_shared/idempotency.ts";
import { normalizeE164 } from "../../_shared/phone.ts";
import type { CreateBookingArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof CreateBookingArgsSchema>;

export type CreateBookingResult =
  | { booking_id: string; confirmed: true; start: string; end: string }
  | {
      confirmed: false;
      reason: "slot_taken" | "invalid_phone";
      nearest_alternative?: { start: string; end: string };
    };

const EXCLUSION_VIOLATION = "23P01";
const UNIQUE_VIOLATION = "23505";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/**
 * BACKEND_SPEC §7.2.2 — one INSERT, race-proof. Never check-then-insert: the
 * GIST exclusion constraint on `(resource_id, during) where status =
 * 'confirmed'` is the race-proofing (SYSTEM_DESIGN §5); this handler just
 * inserts and interprets the constraint-violation error code. Idempotent on
 * `(tenant_id, idempotency_key)` — a Retell retry of the same tool call
 * with the same args returns the existing booking rather than erroring or
 * duplicating.
 */
export async function createBooking(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<CreateBookingResult> {
  const phone = normalizeE164(args.customer.phone);
  if (!phone) {
    return { confirmed: false, reason: "invalid_phone" };
  }

  const idempotencyKey = bookingIdempotencyKey(ctx.retellCallId, args.start);

  // Idempotent replay: a prior identical tool call already created this
  // booking — return it rather than re-inserting or erroring.
  const existing = await sql<{ id: string; start_at: string; end_at: string }>`
    select id, start_at, end_at from public.bookings
    where tenant_id = ${ctx.tenantId} and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const priorBooking = existing[0];
  if (priorBooking) {
    return {
      booking_id: priorBooking.id,
      confirmed: true,
      start: priorBooking.start_at,
      end: priorBooking.end_at,
    };
  }

  const customerRows = await sql<{ id: string }>`
    insert into public.customers (tenant_id, phone_e164, name)
    values (${ctx.tenantId}, ${phone}, ${args.customer.name ?? null})
    on conflict (tenant_id, phone_e164)
    do update set name = coalesce(excluded.name, public.customers.name), last_seen_at = now()
    returning id
  `;
  const customerId = customerRows[0]?.id ?? null;

  const consentPayload = args.consent
    ? {
        sms: args.consent.sms ?? false,
        call: args.consent.call ?? false,
        captured_at: new Date().toISOString(),
        call_id: ctx.retellCallId,
      }
    : null;

  try {
    const inserted = await sql<{ id: string; start_at: string; end_at: string }>`
      insert into public.bookings (
        tenant_id, resource_id, offering_id, customer_id, start_at, end_at,
        status, party_size, source_call_id, idempotency_key, structured_payload
      ) values (
        ${ctx.tenantId}, ${args.resource_id}, ${args.offering_id ?? null}, ${customerId},
        ${args.start}, ${args.end}, 'confirmed', ${args.party_size ?? null}, ${ctx.callLogId},
        ${idempotencyKey}, ${JSON.stringify(args.structured_payload ?? {})}::jsonb
      )
      returning id, start_at, end_at
    `;

    if (consentPayload && customerId) {
      await sql`
        update public.customers set consent = ${JSON.stringify(consentPayload)}::jsonb
        where id = ${customerId}
      `;
    }

    const booking = inserted[0];
    if (!booking) {
      return { confirmed: false, reason: "slot_taken" };
    }
    return {
      booking_id: booking.id,
      confirmed: true,
      start: booking.start_at,
      end: booking.end_at,
    };
  } catch (err) {
    if (isPgError(err, EXCLUSION_VIOLATION) || isPgError(err, UNIQUE_VIOLATION)) {
      // Concurrent double-book (exclusion constraint) or a benign
      // idempotency-key race (unique constraint) — either way, never a
      // duplicate booking and never a raw DB error surfaced to the model.
      const raceWinner = await sql<{ id: string; start_at: string; end_at: string }>`
        select id, start_at, end_at from public.bookings
        where tenant_id = ${ctx.tenantId} and idempotency_key = ${idempotencyKey}
        limit 1
      `;
      const won = raceWinner[0];
      if (won) {
        return { booking_id: won.id, confirmed: true, start: won.start_at, end: won.end_at };
      }
      return { confirmed: false, reason: "slot_taken" };
    }
    throw err;
  }
}
