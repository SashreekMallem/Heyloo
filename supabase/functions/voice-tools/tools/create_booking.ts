import type { z } from "zod";
import { enqueueAdapterPush } from "../../_shared/adapter-push.ts";
import { issueDentalIntakeToken } from "../../_shared/dental-intake.ts";
import { bookingIdempotencyKey } from "../../_shared/idempotency.ts";
import { normalizeE164 } from "../../_shared/phone.ts";
import { sanitizeBookingStructuredPayload } from "../../_shared/schemas/booking-payloads.ts";
import type { CreateBookingArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof CreateBookingArgsSchema>;

/**
 * FIX_REQUESTS.md: dental-intake deps, optional so every existing 3-arg
 * `createBooking(sql, ctx, args)` call site (the whole existing test
 * suite) keeps compiling/passing unchanged. When omitted, or for any
 * non-dental tenant, the intake-token step is simply skipped — this
 * function's own dental-only gating below never depends on the caller
 * having passed `deps`.
 */
export interface CreateBookingDeps {
  logger: Logger;
  /** `APP_BASE_URL` — the base the one-time intake link is built against. */
  appBaseUrl: string;
}

export type CreateBookingResult =
  | { booking_id: string; confirmed: true; start: string; end: string }
  | {
      confirmed: false;
      reason: "slot_taken" | "invalid_phone" | "resource_not_found" | "offering_not_found";
      nearest_alternative?: { start: string; end: string };
    };

const EXCLUSION_VIOLATION = "23P01";
const UNIQUE_VIOLATION = "23505";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/**
 * GAP_REGISTER.md §1.8 — `customers.metadata` (`vehicles`/`pets`,
 * `20260907130400_customers.sql`'s own column comment) was never written,
 * so a returning caller could never be recognized by `lookup_customer`'s
 * already-existing `vehicles`/`pets` read (`lookup_customer.ts`). This
 * extracts the small subset of a vertical's typed `structured_payload`
 * (`packages/canonical-types/src/booking-payloads.ts` — mirrored here
 * field-for-field since Deno can't import that Node/ESM package, same
 * documented constraint as `admin/schemas.ts`) that identifies a
 * recurring asset (a vehicle, a pet), and returns the metadata KEY to
 * merge it under plus the deduped array to write — `null` when this
 * vertical/payload has nothing worth remembering, so the caller can skip
 * the extra write entirely on the common case.
 */
function extractMetadataMerge(
  vertical: string,
  payload: Record<string, unknown>,
  existingMetadata: Record<string, unknown>,
): { key: "vehicles" | "pets"; entries: Record<string, unknown>[] } | null {
  if (vertical === "auto") {
    const entry: Record<string, unknown> = {};
    if (typeof payload["vehicle_year"] === "number") entry["year"] = payload["vehicle_year"];
    if (typeof payload["vehicle_make"] === "string") entry["make"] = payload["vehicle_make"];
    if (typeof payload["vehicle_model"] === "string") entry["model"] = payload["vehicle_model"];
    if (Object.keys(entry).length === 0) return null;
    const existing = Array.isArray(existingMetadata["vehicles"])
      ? (existingMetadata["vehicles"] as Record<string, unknown>[])
      : [];
    const serialized = JSON.stringify(entry);
    if (existing.some((v) => JSON.stringify(v) === serialized)) return null;
    return { key: "vehicles", entries: [...existing, entry] };
  }
  if (vertical === "vet") {
    const entry: Record<string, unknown> = {};
    if (typeof payload["pet_name"] === "string") entry["name"] = payload["pet_name"];
    if (typeof payload["species"] === "string") entry["species"] = payload["species"];
    if (typeof payload["breed"] === "string") entry["breed"] = payload["breed"];
    if (typeof payload["age_years"] === "number") entry["age_years"] = payload["age_years"];
    if (Object.keys(entry).length === 0) return null;
    const existing = Array.isArray(existingMetadata["pets"])
      ? (existingMetadata["pets"] as Record<string, unknown>[])
      : [];
    const serialized = JSON.stringify(entry);
    if (existing.some((p) => JSON.stringify(p) === serialized)) return null;
    return { key: "pets", entries: [...existing, entry] };
  }
  return null;
}

interface DepositPolicy {
  required?: boolean;
  hold_window_hours?: number;
}

const DEFAULT_DEPOSIT_HOLD_HOURS = 24;

/**
 * OPS-5 (docs/BUILD_NOTES.md — recurring `create_booking` batch-test
 * failure): resolves the resource to book server-side rather than trusting
 * `args.resource_id` verbatim. The batch-test simulator's caller-LLM
 * sometimes invents or misremembers a `resource_id` a few turns after
 * `check_availability` returned the real ones (a plain LLM-recall error,
 * not an authorization concern — `check_availability`'s own results are
 * already tenant-scoped and available-only); previously that always
 * failed the booking outright with `resource_not_found`, even though a
 * perfectly good resource for the requested window existed. Resolution
 * order:
 *   1. exact id match, scoped to this tenant + active (the fast, correct-
 *      model-behavior path — zero extra query beyond what already ran).
 *   2. `resource_name`, if the model supplied one — case-insensitive match
 *      against this tenant's active resources.
 *   3. first-available — the earliest (by id, deterministic) resource that
 *      genuinely has an `availability_slots` row covering the requested
 *      `[start, end)` window, i.e. the exact table `check_availability`
 *      itself reads, so this can only ever resolve onto a resource that
 *      really is open then, never an arbitrary one.
 * Returns `null` (→ `resource_not_found`) only when none of the three
 * resolves — never widens which resource a call is authorized to book,
 * only which one of THIS tenant's genuinely-open resources it lands on.
 */
async function resolveBookingResourceId(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<string | null> {
  const exact = await sql<{ id: string }>`
    select id from public.resources
    where id = ${args.resource_id} and tenant_id = ${ctx.tenantId} and active
    limit 1
  `;
  if (exact[0]) return exact[0].id;

  if (args.resource_name) {
    const byName = await sql<{ id: string }>`
      select id from public.resources
      where tenant_id = ${ctx.tenantId} and active and name ilike ${args.resource_name}
      order by id asc
      limit 1
    `;
    if (byName[0]) return byName[0].id;
  }

  const firstAvailable = await sql<{ id: string }>`
    select id from public.resources
    where tenant_id = ${ctx.tenantId} and active
      and id in (
        select resource_id from public.availability_slots
        where tenant_id = ${ctx.tenantId} and is_available = true
          and slot_range && tstzrange(${args.start}, ${args.end})
      )
    order by id asc
    limit 1
  `;
  return firstAvailable[0]?.id ?? null;
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
  deps?: CreateBookingDeps,
): Promise<CreateBookingResult> {
  const phone = normalizeE164(args.customer.phone);
  if (!phone) {
    return { confirmed: false, reason: "invalid_phone" };
  }

  // EDGE_AUDIT B1: every referenced id must be verified to belong to the
  // caller's OWN tenant before it's ever written — same pattern already
  // used by `update_booking`/`cancel_booking`/`create_order`/
  // `send_payment_link`. `args.resource_id` comes straight from the Retell
  // tool-call args (Zod-shape-validated only, not ownership-validated); a
  // mismatch is resolved server-side (`resolveBookingResourceId` above)
  // rather than failing outright — an LLM-hallucinated id can only ever
  // land on one of THIS tenant's own genuinely-open resources, never
  // widen authorization to another tenant's.
  const resolvedResourceId = await resolveBookingResourceId(sql, ctx, args);
  if (!resolvedResourceId) {
    return { confirmed: false, reason: "resource_not_found" };
  }
  if (resolvedResourceId !== args.resource_id) {
    deps?.logger.warn("create_booking_resource_id_resolved_fallback", {
      tenant_id: ctx.tenantId,
      call_id: ctx.retellCallId,
      requested_resource_id: args.resource_id,
      requested_resource_name: args.resource_name ?? null,
      resolved_resource_id: resolvedResourceId,
    });
  }

  if (args.offering_id) {
    const offeringRows = await sql<{ id: string }>`
      select id from public.offerings
      where id = ${args.offering_id} and tenant_id = ${ctx.tenantId} and active
      limit 1
    `;
    if (!offeringRows[0]) {
      return { confirmed: false, reason: "offering_not_found" };
    }
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

  const customerRows = await sql<{ id: string; metadata: Record<string, unknown> }>`
    insert into public.customers (tenant_id, phone_e164, name)
    values (${ctx.tenantId}, ${phone}, ${args.customer.name ?? null})
    on conflict (tenant_id, phone_e164)
    do update set name = coalesce(excluded.name, public.customers.name), last_seen_at = now()
    returning id, metadata
  `;
  const customerId = customerRows[0]?.id ?? null;
  const customerMetadata = customerRows[0]?.metadata ?? {};

  const consentPayload = args.consent
    ? {
        sms: args.consent.sms ?? false,
        call: args.consent.call ?? false,
        captured_at: new Date().toISOString(),
        call_id: ctx.retellCallId,
      }
    : null;

  // GAP_REGISTER.md §1.7 — validate the model-supplied `structured_payload`
  // against this vertical's real typed shape (`_shared/schemas/
  // booking-payloads.ts`, mirrored from `packages/canonical-types`) before
  // it's ever inserted. Per-field sanitize, never a hard gate: an
  // individually malformed field (e.g. a non-numeric `vehicle_year`) is
  // dropped rather than trusted verbatim or failing the whole booking.
  const structuredPayload = sanitizeBookingStructuredPayload(
    ctx.vertical,
    args.structured_payload ?? {},
  );

  // GAP_REGISTER.md §2 Motel item 4 — "held scheduled until paid": a
  // tenant-configured required deposit (`agent_configs.
  // dynamic_variable_overrides.deposit_policy`, `zMotelOverrides`) inserts
  // this booking `scheduled` rather than `confirmed`, with a
  // `hold_expires_at` a cron sweep (20260910122000_motel_deposit_hold_expiry_cron.sql)
  // cancels past if still unpaid — `webhooks-stripe/handler.ts` already
  // flips a paid deposit's booking to `confirmed` on the Stripe webhook.
  // Scoped to `vertical === 'motel'` so every other vertical's hot path
  // never pays for this extra query. The hold actually blocks a second
  // caller at the DB level: `bookings_hold_exclusion` (a partial GIST
  // exclusion scoped to `status = 'scheduled' and hold_expires_at is not
  // null`, 20260910170000_motel_hold_exclusion.sql) races this INSERT
  // against any other unexpired hold on the same resource/range, and the
  // same trigger extension flips `availability_slots.is_available = false`
  // for the held range so `check_availability` stops offering it.
  let bookingStatus: "confirmed" | "scheduled" = "confirmed";
  let holdExpiresAt: string | null = null;
  if (ctx.vertical === "motel") {
    const configRows = await sql<{ dynamic_variable_overrides: Record<string, unknown> }>`
      select dynamic_variable_overrides from public.agent_configs where tenant_id = ${ctx.tenantId}
    `;
    const overrides = configRows[0]?.dynamic_variable_overrides ?? {};
    const depositPolicy = overrides["deposit_policy"] as DepositPolicy | undefined;
    if (depositPolicy?.required) {
      bookingStatus = "scheduled";
      const holdHours =
        typeof depositPolicy.hold_window_hours === "number"
          ? depositPolicy.hold_window_hours
          : DEFAULT_DEPOSIT_HOLD_HOURS;
      holdExpiresAt = new Date(Date.now() + holdHours * 3_600_000).toISOString();
    }
  }

  // GAP_REGISTER.md §2 Motel item 5 — the exact nightly rate quoted from
  // {{rate_table}} (never model-invented, motel.ts's RATE_DISCIPLINE_FRAGMENT)
  // mirrored onto a real column so a rate dispute is recoverable without a
  // transcript re-listen. A malformed/non-integer value is simply dropped
  // (never blocks the booking — hot-path graceful-fallback discipline).
  const rawQuotedRate = structuredPayload["quoted_rate_cents"];
  const quotedRateCents =
    ctx.vertical === "motel" &&
    typeof rawQuotedRate === "number" &&
    Number.isInteger(rawQuotedRate) &&
    rawQuotedRate >= 0
      ? rawQuotedRate
      : null;

  try {
    const inserted = await sql<{ id: string; start_at: string; end_at: string }>`
      insert into public.bookings (
        tenant_id, resource_id, offering_id, customer_id, start_at, end_at,
        status, party_size, source_call_id, idempotency_key, structured_payload,
        quoted_rate_cents, hold_expires_at
      ) values (
        ${ctx.tenantId}, ${resolvedResourceId}, ${args.offering_id ?? null}, ${customerId},
        ${args.start}, ${args.end}, ${bookingStatus}, ${args.party_size ?? null}, ${ctx.callLogId},
        ${idempotencyKey}, ${structuredPayload}::jsonb,
        ${quotedRateCents}, ${holdExpiresAt}
      )
      returning id, start_at, end_at
    `;

    if (consentPayload && customerId) {
      await sql`
        update public.customers set consent = ${consentPayload}::jsonb
        where id = ${customerId}
      `;
    }

    // GAP_REGISTER.md §1.8 — vehicles (auto) / pets (vet) recurring-asset
    // history, so a repeat caller's `lookup_customer` result can skip
    // re-asking (see that tool's already-existing `vehicles`/`pets` read).
    // Skipped entirely (zero extra query) when this vertical/call has
    // nothing new to remember.
    const metadataMerge = extractMetadataMerge(ctx.vertical, structuredPayload, customerMetadata);
    if (metadataMerge && customerId) {
      await sql`
        update public.customers
        set metadata = metadata || ${{ [metadataMerge.key]: metadataMerge.entries }}::jsonb
        where id = ${customerId}
      `;
    }

    const booking = inserted[0];
    if (!booking) {
      return { confirmed: false, reason: "slot_taken" };
    }

    // GAP_REGISTER.md §1.7 — mirrors this call's typed booking capture onto
    // `call_logs.structured_booking_payload` (a dashboard "Linked booking"
    // card column that was asked for but never written by anything).
    // Skipped when the model captured nothing this call — never clobbers a
    // populated column with an empty object.
    if (Object.keys(structuredPayload).length > 0) {
      await sql`
        update public.call_logs
        set structured_booking_payload = ${structuredPayload}::jsonb
        where id = ${ctx.callLogId} and tenant_id = ${ctx.tenantId}
      `;
    }

    // FIX_REQUESTS.md: dental-only, best-effort post-booking intake-link
    // send. Never throws/blocks the booking itself on failure — same
    // fail-open posture as any other post-booking side effect (reminders,
    // review requests) — wrapped in try/catch and logged.
    if (ctx.vertical === "dental" && deps) {
      try {
        await issueDentalIntakeToken(
          sql,
          {
            tenantId: ctx.tenantId,
            bookingId: booking.id,
            customerPhoneE164: phone,
            customerName: args.customer.name ?? null,
          },
          { appBaseUrl: deps.appBaseUrl },
        );
      } catch (err) {
        deps.logger.error("dental_intake_token_issue_failed", {
          booking_id: booking.id,
          tenant_id: ctx.tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // E2E_FLOWS_AUDIT B4 (producer side): push this booking to every
    // connected deep-integration adapter — never inline (hot-path
    // discipline), and a no-op for the common case of a tenant with no
    // connected adapter.
    await enqueueAdapterPush(sql, {
      tenantId: ctx.tenantId,
      entityType: "booking",
      entityId: booking.id,
      idempotencyKey,
    });

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
