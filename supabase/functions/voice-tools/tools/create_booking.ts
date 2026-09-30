import type { z } from "zod";
import { enqueueAdapterPush } from "../../_shared/adapter-push.ts";
import { alertCustomAnswers } from "../../_shared/custom-questions.ts";
import { issueDentalIntakeToken } from "../../_shared/dental-intake.ts";
import { bookingIdempotencyKey } from "../../_shared/idempotency.ts";
import { enqueueOwnerAlertBestEffort } from "../../_shared/owner-alerts.ts";
import { normalizeE164 } from "../../_shared/phone.ts";
import { sanitizeBookingStructuredPayload } from "../../_shared/schemas/booking-payloads.ts";
import type { CreateBookingArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { MANUAL_MODE_BOOKING_MESSAGE } from "../manual-mode.ts";
import { formatLocalHuman, toTenantLocalIso } from "./local-time.ts";
import { normalizeInstant, normalizeTimeRange } from "./time-args.ts";

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
  /**
   * HOTPATH: runs the post-commit side effects (customer vehicle/pet memory,
   * `call_logs.structured_booking_payload`, dental intake link, adapter
   * push) AFTER the tool response instead of before it. `voice-tools` passes
   * `EdgeRuntime.waitUntil`-backed scheduling; when omitted (the text
   * agent) they are awaited inline, as before. Either way none of them can
   * turn a committed booking into a failure result any more.
   */
  defer?: (label: string, task: () => Promise<void>) => void;
  /**
   * HOTPATH: checked synchronously immediately before the booking write is
   * issued. `true` means the dispatcher has already answered the caller
   * (deadline passed), so the write must never start — that is what makes a
   * "nothing was booked" answer after a timeout stay true.
   */
  isAborted?: () => boolean;
}

export type CreateBookingResult =
  | { booking_id: string; confirmed: true; start: string; end: string }
  | {
      confirmed: false;
      reason:
        | "slot_taken"
        | "invalid_phone"
        | "resource_not_found"
        | "offering_not_found"
        | "start_in_past"
        | "too_soon"
        | "outside_hours"
        | "invalid_time"
        | "manual_mode"
        | "not_completed";
      nearest_alternative?: { start: string; end: string };
      message?: string;
    };

/** HOTPATH: the model-facing instruction for `reason: "start_in_past"`. */
export const START_IN_PAST_MESSAGE =
  "That time has already passed, so it was NOT booked. Call check_availability again and offer the caller one of the upcoming times it returns.";

/** VOICE-ALERTS-1 review: the model-facing instruction for `reason: "too_soon"`
 * (the owner's minimum booking notice, `tenants.booking_min_notice_minutes`). */
export const TOO_SOON_MESSAGE =
  "That time is sooner than the business takes bookings for, so it was NOT booked. Call check_availability again and offer the caller one of the times it returns.";

/** QA-1 BE-06: the model-facing instruction for `reason: "outside_hours"`. */
export const OUTSIDE_HOURS_MESSAGE =
  "That time is outside the hours this business takes bookings for (closed, before opening, after closing, or beyond how far ahead it books), so it was NOT booked. Call check_availability again and offer the caller one of the times it returns.";

/** HOTPATH-REVIEW: the model-facing instruction for `reason: "invalid_time"`. */
export const INVALID_TIME_MESSAGE =
  "The start or end time could not be read, so it was NOT booked. Call create_booking again with start and end as full ISO 8601 timestamps, exactly as check_availability returned them, with end after start.";

const EXCLUSION_VIOLATION = "23P01";
const UNIQUE_VIOLATION = "23505";
/** `invalid input syntax for type timestamp with time zone` / out of range —
 * the model sent a start/end Postgres cannot parse. */
const INVALID_DATETIME_FORMAT = "22007";
const DATETIME_FIELD_OVERFLOW = "22008";

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

/** A real `resources.id` / `offerings.id` is a Postgres `uuid` — matching
 * this shape BEFORE ever binding a model-supplied id into a `where id = ...`
 * comparison is what makes CALL-8's `default`-literal fix actually safe: an
 * obviously-non-UUID value (Retell live-observed literal `"default"`,
 * matching CALL-2/OPS-5's own documented "model invents a placeholder id"
 * class of bug) would otherwise make Postgres THROW `invalid input syntax
 * for type uuid` rather than simply returning zero rows. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HOTPATH: the booking's idempotency key — the single definition shared by
 * `createBooking` and `voice-tools/handler.ts`'s timeout recovery, so the
 * recovery looks for exactly the row the write would have created. */
export function createBookingIdempotencyKey(ctx: CallContext, args: Pick<Args, "start">): string {
  // HOTPATH-REVIEW: keyed on the normalized instant, not the raw string, so
  // a retry that writes the same time differently (the local-offset form
  // check_availability now returns vs. UTC) is still a replay. Keyed on the
  // raw string otherwise, it missed the replay and, reproduced against a
  // real Postgres 16, either answered slot_taken for the caller's own
  // booking or, with resource_id omitted, booked the caller a second time
  // on another resource. The normalized form is what postgres.js stores
  // anyway (`time-args.ts`), and it equals the old key for the UTC `...Z`
  // strings check_availability used to return.
  return bookingIdempotencyKey(ctx.retellCallId, normalizeInstant(args.start) ?? args.start);
}

interface BookingRow {
  id: string;
  start_at: string | Date;
  end_at: string | Date;
}

/** Renders a booking time for the model in the tenant's timezone (see
 * `toTenantLocalIso`); falls back to the pre-HOTPATH shape. */
function localIso(value: string | Date, tz: string | null | undefined): string {
  const rendered = toTenantLocalIso(value, tz);
  return typeof rendered === "string" ? rendered : String(rendered);
}

function confirmedResult(row: BookingRow, tz: string | null | undefined): CreateBookingResult {
  return {
    booking_id: row.id,
    confirmed: true,
    start: localIso(row.start_at, tz),
    end: localIso(row.end_at, tz),
  };
}

/**
 * HOTPATH (docs/BUILD_NOTES.md): every read `create_booking` needs before its
 * write, in ONE statement (one round trip; two on a connection that has not
 * prepared it yet). Before this, the same reads were 3-6 sequential
 * statements (resource tier(s), offering + idempotency pair, motel config),
 * and with the post-insert writes the tool ran 7-9 statements; live, the
 * row committed ~1.1-1.4 s in and the tool hit the 1.5 s abort 5/5 times.
 *
 * Columns:
 *  - `replay_*`: an existing booking under this call's idempotency key
 *    (Retell retry, or the model re-calling after a timeout answer) — checked
 *    FIRST, so a legitimate replay is never refused because its own slot is
 *    no longer `is_available`.
 *  - `exact_resource_id`: OPS-5 tier 1 (id match, this tenant, active).
 *  - `first_available_resource_id`: OPS-5 tier 3, computed here only when
 *    tier 1 missed AND the model gave no `resource_name` (tier 2 needs its own
 *    statement and runs, with tier 3 after it, only in that rare case).
 *  - `offering_ok`: EDGE_AUDIT B1 offering ownership.
 *  - `start_in_past`: the requested start has already passed. For a
 *    day-length booking (a motel night, local midnight to local midnight)
 *    the check is "check-in date before today in the tenant's timezone"
 *    instead, since tonight's slot started at midnight but is still
 *    bookable in the evening. HOTPATH-REVIEW: "day-length" is `>= interval '23 hours'`,
 *    not `'1 day'` (= 24 h): the spring-forward night is 23 hours long, so
 *    with `'1 day'` that night was rejected as `start_in_past` from local
 *    midnight on. check_availability's cutoff uses the same threshold.
 *  - `tz`: `tenants.timezone`, for rendering the returned times.
 *  - `deposit_overrides`: motel-only `agent_configs.dynamic_variable_overrides`
 *    (GAP_REGISTER.md §2 Motel item 4); NULL for every other vertical.
 */
interface PreflightRow {
  replay_id: string | null;
  replay_start: string | Date | null;
  replay_end: string | Date | null;
  exact_resource_id: string | null;
  first_available_resource_id: string | null;
  offering_ok: boolean;
  /** VOICE-ALERTS-1: the offering's name, for the owner's new-booking alert
   * (same statement, no extra round trip). */
  offering_name?: string | null;
  start_in_past: boolean;
  /** VOICE-ALERTS-1 review: the start is inside the owner-set minimum notice
   * (`tenants.booking_min_notice_minutes`; only when the owner set one, and
   * never for a day-length night). `check_availability` already withholds
   * such slots; this stops a caller-supplied time from skipping that. */
  too_soon?: boolean;
  /** QA-1 BE-06: a slot row (generated, or otherwise available) of the exact
   * resource contains the requested start. `availability_slots` only exist
   * for open windows inside the booking horizon, so `false` means a closed
   * day, before/after hours, or beyond the horizon. `null`/absent = not
   * evaluated (no exact resource). Only an explicit `false` refuses. */
  exact_in_hours?: boolean | null;
  /** Same for ANY active resource; evaluated only when there is no exact
   * resource (name / first-available tiers), else `null`. */
  any_in_hours?: boolean | null;
  tz: string | null;
  deposit_overrides: Record<string, unknown> | null;
}

async function preflight(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
  idempotencyKey: string,
  exactResourceId: string | null,
  offeringId: string | null,
): Promise<PreflightRow> {
  const lookupFirstAvailable = !args.resource_name;
  const isMotel = ctx.vertical === "motel";
  const rows = await sql<PreflightRow>`
    /* create_booking:preflight */
    with replay as (
      select id, start_at, end_at from public.bookings
      where tenant_id = ${ctx.tenantId} and idempotency_key = ${idempotencyKey}
      limit 1
    ), ex as (
      select id from public.resources
      where id = ${exactResourceId}::uuid and tenant_id = ${ctx.tenantId} and active
      limit 1
    ), tn as (
      -- The owner minimum notice is read via to_jsonb(t) ->> ..., not as a
      -- column, so this keeps working on a database where
      -- 20260929140000_tenant_booking_rules.sql is not applied yet (a plain
      -- column reference would fail every booking with 42703 there).
      select timezone, (to_jsonb(t) ->> 'booking_min_notice_minutes')::int as notice
      from public.tenants t where t.id = ${ctx.tenantId}
    )
    select
      (select id from replay) as replay_id,
      (select start_at from replay) as replay_start,
      (select end_at from replay) as replay_end,
      (select id from ex) as exact_resource_id,
      case when ${lookupFirstAvailable} and not exists (select 1 from ex) then (
        select r.id from public.resources r
        where r.tenant_id = ${ctx.tenantId} and r.active
          and r.id in (
            select s.resource_id from public.availability_slots s
            where s.tenant_id = ${ctx.tenantId} and s.is_available = true
              and s.slot_range && tstzrange(${args.start}::timestamptz, ${args.end}::timestamptz)
          )
        order by r.id asc
        limit 1
      ) end as first_available_resource_id,
      case when ${offeringId}::uuid is null then true else exists (
        select 1 from public.offerings
        where id = ${offeringId}::uuid and tenant_id = ${ctx.tenantId} and active
      ) end as offering_ok,
      case
        when ${args.end}::timestamptz - ${args.start}::timestamptz >= interval '23 hours'
          then ${args.start}::timestamptz < (
            date_trunc('day', now() at time zone (select timezone from tn))
              at time zone (select timezone from tn)
          )
        else ${args.start}::timestamptz < now()
      end as start_in_past,
      case
        when (select notice from tn) is null then false
        when ${args.end}::timestamptz - ${args.start}::timestamptz >= interval '23 hours' then false
        else ${args.start}::timestamptz < now() + make_interval(mins => (select notice from tn))
      end as too_soon,
      (select timezone from tn) as tz,
      case when (select id from ex) is not null then exists (
        select 1 from public.availability_slots s
        where s.tenant_id = ${ctx.tenantId} and s.resource_id = (select id from ex)
          and s.slot_range @> ${args.start}::timestamptz
          and (s.is_available or s.source = 'generated')
      ) end as exact_in_hours,
      case when (select id from ex) is null then exists (
        select 1 from public.availability_slots s
        join public.resources r on r.id = s.resource_id and r.active
        where s.tenant_id = ${ctx.tenantId}
          and s.slot_range @> ${args.start}::timestamptz
          and (s.is_available or s.source = 'generated')
      ) end as any_in_hours,
      case when ${isMotel} then (
        select dynamic_variable_overrides from public.agent_configs
        where tenant_id = ${ctx.tenantId}
        limit 1
      ) end as deposit_overrides,
      (select name from public.offerings
        where id = ${offeringId}::uuid and tenant_id = ${ctx.tenantId}) as offering_name
  `;
  const row = rows[0];
  if (!row) {
    // A FROM-less select always returns exactly one row; an empty result
    // means the client/driver misbehaved — fail loudly, never guess.
    throw new Error("create_booking_preflight_empty");
  }
  return row;
}

/** OPS-5 tier 2 — only when tier 1 missed and the model named a resource. */
async function resourceByName(
  sql: SqlClient,
  ctx: CallContext,
  name: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }>`
    select id from public.resources
    where tenant_id = ${ctx.tenantId} and active and name ilike ${name}
    order by id asc
    limit 1
  `;
  return rows[0]?.id ?? null;
}

/** OPS-5 tier 3 as its own statement — only after a tier-2 miss (when no
 * `resource_name` was given, the preflight already computed it). */
async function firstAvailableResource(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<string | null> {
  const rows = await sql<{ id: string }>`
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
  return rows[0]?.id ?? null;
}

/**
 * HOTPATH: read-only lookup of a booking committed under this call's
 * idempotency key, rendered exactly like a successful `createBooking`
 * result. Used by `voice-tools/handler.ts` after a create_booking deadline
 * to answer truthfully from what the database actually holds.
 */
export async function findCommittedBooking(
  sql: SqlClient,
  ctx: CallContext,
  idempotencyKey: string,
): Promise<CreateBookingResult | null> {
  const rows = await sql<BookingRow & { tz: string | null }>`
    /* create_booking:verify */
    select b.id, b.start_at, b.end_at,
      (select timezone from public.tenants where id = ${ctx.tenantId}) as tz
    from public.bookings b
    where b.tenant_id = ${ctx.tenantId} and b.idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const row = rows[0];
  return row ? confirmedResult(row, row.tz) : null;
}

/**
 * BACKEND_SPEC §7.2.2 — one INSERT, race-proof. Never check-then-insert: the
 * GIST exclusion constraint on `(resource_id, during) where status =
 * 'confirmed'` is the race-proofing (SYSTEM_DESIGN §5); this handler just
 * inserts and interprets the constraint-violation error code. Idempotent on
 * `(tenant_id, idempotency_key)` — a Retell retry of the same tool call
 * with the same args returns the existing booking rather than erroring or
 * duplicating.
 *
 * CALL-6 (docs/BUILD_NOTES.md): `is_test` mirrors `ctx.isTestCall`
 * (ultimately `call_logs.is_test_call`) directly — never re-derived here —
 * so a Retell batch-test/simulator booking is flagged from the moment it's
 * written, before the dashboard bookings list or any KPI aggregate ever
 * reads it.
 *
 * HOTPATH (docs/BUILD_NOTES.md): the common path is now exactly two
 * statements — `preflight` (every read) and one write that upserts the
 * customer (with the consent capture) and inserts the booking atomically.
 * The side effects that used to run before the answer (customer
 * vehicle/pet memory, `call_logs.structured_booking_payload`, dental intake
 * link, adapter push) run after it (`deps.defer`), and none of them can
 * report a committed booking as a failure any more.
 */
export async function createBooking(
  sql: SqlClient,
  ctx: CallContext,
  input: Args,
  deps?: CreateBookingDeps,
): Promise<CreateBookingResult> {
  // VOICE-ALERTS-1: Manual Mode — the owner turned automatic booking off.
  // Answered before any SQL (the flag rode in on the call context), so
  // nothing is written and the agent falls back to `take_message`.
  if (ctx.manualMode) {
    return { confirmed: false, reason: "manual_mode", message: MANUAL_MODE_BOOKING_MESSAGE };
  }
  const phone = normalizeE164(input.customer.phone);
  if (!phone) {
    return { confirmed: false, reason: "invalid_phone" };
  }
  // HOTPATH-REVIEW (`time-args.ts`): an unparseable or backwards start/end
  // is answered here, before any SQL. From here on only the normalized
  // values are bound; they are byte-for-byte what postgres.js would have
  // sent for a valid input, so nothing about what is stored changes.
  const when = normalizeTimeRange(input.start, input.end);
  if (!when) {
    return { confirmed: false, reason: "invalid_time", message: INVALID_TIME_MESSAGE };
  }
  const args: Args = { ...input, start: when.start, end: when.end };
  const offeringId = args.offering_id ?? null;
  if (offeringId && !UUID_RE.test(offeringId)) {
    // EDGE_AUDIT B1: a non-UUID offering id can never be one of this
    // tenant's offerings — answer without binding it (a bind would throw).
    return { confirmed: false, reason: "offering_not_found" };
  }

  const idempotencyKey = createBookingIdempotencyKey(ctx, args);
  // CALL-8: skip tier 1 for an omitted or non-UUID resource_id.
  const exactResourceId =
    args.resource_id && UUID_RE.test(args.resource_id) ? args.resource_id : null;

  let pre: PreflightRow;
  try {
    pre = await preflight(sql, ctx, args, idempotencyKey, exactResourceId, offeringId);
  } catch (err) {
    if (isPgError(err, INVALID_DATETIME_FORMAT) || isPgError(err, DATETIME_FIELD_OVERFLOW)) {
      return { confirmed: false, reason: "invalid_time", message: INVALID_TIME_MESSAGE };
    }
    throw err;
  }

  // Idempotent replay: a prior identical tool call already created this
  // booking — return it rather than re-inserting or erroring.
  if (pre.replay_id && pre.replay_start && pre.replay_end) {
    return confirmedResult(
      { id: pre.replay_id, start_at: pre.replay_start, end_at: pre.replay_end },
      pre.tz,
    );
  }
  if (pre.start_in_past) {
    return { confirmed: false, reason: "start_in_past", message: START_IN_PAST_MESSAGE };
  }
  if (pre.too_soon) {
    return { confirmed: false, reason: "too_soon", message: TOO_SOON_MESSAGE };
  }
  if (offeringId && !pre.offering_ok) {
    return { confirmed: false, reason: "offering_not_found" };
  }

  // EDGE_AUDIT B1 / OPS-5 (see PreflightRow): every referenced id is
  // verified to belong to the caller's OWN tenant before it's ever written;
  // a hallucinated id can only land on one of THIS tenant's own
  // genuinely-open resources, never widen authorization to another's.
  let resolvedResourceId = pre.exact_resource_id;
  if (!resolvedResourceId) {
    resolvedResourceId = args.resource_name
      ? ((await resourceByName(sql, ctx, args.resource_name)) ??
        (await firstAvailableResource(sql, ctx, args)))
      : pre.first_available_resource_id;
  }
  if (!resolvedResourceId) {
    return { confirmed: false, reason: "resource_not_found" };
  }
  // QA-1 BE-06: the model's start must fall inside a real slot of the resource
  // it lands on. Validation used to be delegated to the model calling
  // check_availability, so a closed Sunday, 3 AM or a date 8 months out was
  // confirmed (an exact resource_id never consulted availability_slots). The
  // GIST exclusion constraint stays the race backstop below.
  const inHours =
    resolvedResourceId === pre.exact_resource_id ? pre.exact_in_hours : pre.any_in_hours;
  if (inHours === false) {
    return { confirmed: false, reason: "outside_hours", message: OUTSIDE_HOURS_MESSAGE };
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
  // The overrides are only fetched (inside the preflight) for
  // `vertical === 'motel'`. The hold actually blocks a second caller at the
  // DB level: `bookings_hold_exclusion` (a partial GIST exclusion scoped to
  // `status = 'scheduled' and hold_expires_at is not null`,
  // 20260910170000_motel_hold_exclusion.sql) races this INSERT against any
  // other unexpired hold on the same resource/range, and the same trigger
  // extension flips `availability_slots.is_available = false` for the held
  // range so `check_availability` stops offering it.
  let bookingStatus: "confirmed" | "scheduled" = "confirmed";
  let holdExpiresAt: string | null = null;
  if (ctx.vertical === "motel") {
    const depositPolicy = pre.deposit_overrides?.["deposit_policy"] as DepositPolicy | undefined;
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

  // HOTPATH: the dispatcher's deadline already passed and it has answered
  // the caller — never start the write after that point.
  if (deps?.isAborted?.()) {
    return { confirmed: false, reason: "not_completed" };
  }

  let written: (BookingRow & { customer_id: string; customer_metadata: unknown }) | undefined;
  try {
    // One atomic statement: the customer upsert (with this call's consent
    // answer, when given) and the booking insert. A constraint violation on
    // the booking rolls back the customer write with it.
    const rows = await sql<BookingRow & { customer_id: string; customer_metadata: unknown }>`
      /* create_booking:write */
      with c as (
        insert into public.customers (tenant_id, phone_e164, name, consent)
        values (
          ${ctx.tenantId}, ${phone}, ${args.customer.name ?? null},
          coalesce(${consentPayload}::jsonb, '{}'::jsonb)
        )
        on conflict (tenant_id, phone_e164) do update set
          name = coalesce(excluded.name, public.customers.name),
          last_seen_at = now(),
          consent = case when ${consentPayload !== null} then excluded.consent else public.customers.consent end
        returning id, metadata
      ), b as (
        insert into public.bookings (
          tenant_id, resource_id, offering_id, customer_id, start_at, end_at,
          status, party_size, source_call_id, idempotency_key, structured_payload,
          quoted_rate_cents, hold_expires_at, is_test
        ) values (
          ${ctx.tenantId}, ${resolvedResourceId}, ${offeringId}, (select id from c),
          ${args.start}, ${args.end}, ${bookingStatus}, ${args.party_size ?? null}, ${ctx.callLogId},
          ${idempotencyKey}, ${structuredPayload}::jsonb,
          ${quotedRateCents}, ${holdExpiresAt}, ${ctx.isTestCall}
        )
        returning id, start_at, end_at
      )
      select b.id, b.start_at, b.end_at,
        (select id from c) as customer_id,
        (select metadata from c) as customer_metadata
      from b
    `;
    written = rows[0];
  } catch (err) {
    if (isPgError(err, EXCLUSION_VIOLATION) || isPgError(err, UNIQUE_VIOLATION)) {
      // Concurrent double-book (exclusion constraint) or a benign
      // idempotency-key race (unique constraint) — either way, never a
      // duplicate booking and never a raw DB error surfaced to the model.
      const raceWinner = await sql<BookingRow>`
        select id, start_at, end_at from public.bookings
        where tenant_id = ${ctx.tenantId} and idempotency_key = ${idempotencyKey}
        limit 1
      `;
      const won = raceWinner[0];
      if (won) return confirmedResult(won, pre.tz);
      return { confirmed: false, reason: "slot_taken" };
    }
    if (isPgError(err, INVALID_DATETIME_FORMAT) || isPgError(err, DATETIME_FIELD_OVERFLOW)) {
      return { confirmed: false, reason: "invalid_time", message: INVALID_TIME_MESSAGE };
    }
    throw err;
  }

  if (!written) {
    return { confirmed: false, reason: "slot_taken" };
  }
  const booking = written;
  const customerMetadata =
    booking.customer_metadata && typeof booking.customer_metadata === "object"
      ? (booking.customer_metadata as Record<string, unknown>)
      : {};

  const postCommit = () =>
    runPostCommitEffects(sql, ctx, deps, {
      bookingId: booking.id,
      customerId: booking.customer_id,
      customerMetadata,
      structuredPayload,
      phone,
      customerName: args.customer.name ?? null,
      idempotencyKey,
      startAt: booking.start_at,
      timezone: pre.tz,
      offeringName: pre.offering_name ?? null,
      // A deposit-hold booking is not confirmed yet; the owner still wants
      // to hear about it.
      pendingDeposit: bookingStatus === "scheduled",
    });
  if (deps?.defer) {
    deps.defer("create_booking_post_commit", postCommit);
  } else {
    await postCommit();
  }

  return confirmedResult(booking, pre.tz);
}

/**
 * The booking is committed before any of these run; each is best-effort,
 * logged on failure, and independent of the others (none reads another's
 * result), so they run concurrently.
 */
async function runPostCommitEffects(
  sql: SqlClient,
  ctx: CallContext,
  deps: CreateBookingDeps | undefined,
  input: {
    bookingId: string;
    customerId: string;
    customerMetadata: Record<string, unknown>;
    structuredPayload: Record<string, unknown>;
    phone: string;
    customerName: string | null;
    idempotencyKey: string;
    startAt: string | Date;
    timezone: string | null;
    offeringName: string | null;
    pendingDeposit: boolean;
  },
): Promise<void> {
  const logFailure =
    (effect: string, event = "create_booking_post_commit_failed") =>
    (err: unknown) => {
      deps?.logger.error(event, {
        effect,
        booking_id: input.bookingId,
        tenant_id: ctx.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    };

  // GAP_REGISTER.md §1.8 — vehicles (auto) / pets (vet) recurring-asset
  // history, so a repeat caller's `lookup_customer` result can skip
  // re-asking. Skipped (no statement) when there is nothing new to remember.
  const metadataMerge = extractMetadataMerge(
    ctx.vertical,
    input.structuredPayload,
    input.customerMetadata,
  );

  await Promise.all([
    metadataMerge
      ? sql`
          update public.customers
          set metadata = metadata || ${{ [metadataMerge.key]: metadataMerge.entries }}::jsonb
          where id = ${input.customerId}
        `.then(() => undefined, logFailure("customer_metadata"))
      : Promise.resolve(),
    // GAP_REGISTER.md §1.7 / CALL-8 — mirrors this call's typed booking
    // capture onto `call_logs.structured_booking_payload` as a jsonb MERGE
    // (never clobbers what an earlier take_message in the same call wrote).
    // Skipped when the model captured nothing this call.
    Object.keys(input.structuredPayload).length > 0
      ? sql`
          update public.call_logs
          set structured_booking_payload = coalesce(structured_booking_payload, '{}'::jsonb) || ${input.structuredPayload}::jsonb
          where id = ${ctx.callLogId} and tenant_id = ${ctx.tenantId}
        `.then(() => undefined, logFailure("call_logs_structured_payload"))
      : Promise.resolve(),
    // FIX_REQUESTS.md: dental-only, best-effort post-booking intake-link send.
    ctx.vertical === "dental" && deps
      ? issueDentalIntakeToken(
          sql,
          {
            tenantId: ctx.tenantId,
            bookingId: input.bookingId,
            customerPhoneE164: input.phone,
            customerName: input.customerName,
          },
          { appBaseUrl: deps.appBaseUrl },
        ).then(
          () => undefined,
          logFailure("dental_intake_token", "dental_intake_token_issue_failed"),
        )
      : Promise.resolve(),
    // E2E_FLOWS_AUDIT B4 (producer side): push this booking to every
    // connected deep-integration adapter — a no-op for the common case of a
    // tenant with no connected adapter.
    enqueueAdapterPush(sql, {
      tenantId: ctx.tenantId,
      entityType: "booking",
      entityId: input.bookingId,
      idempotencyKey: input.idempotencyKey,
    }).then(() => undefined, logFailure("adapter_push")),
    // VOICE-ALERTS-1: tell the owner now, not only when the call is
    // analyzed (`voice-events` sends the same alert at end of call; the
    // per-booking idempotency in `enqueueOwnerAlert` keeps it to one). Runs
    // in this already-deferred batch, so it is off the response path; it is
    // best-effort, skips test calls, and honors the tenant's delivery
    // preferences (SMS/email/both, decided at send time by the worker).
    deps
      ? enqueueOwnerAlertBestEffort(sql, deps.logger, ctx, {
          kind: "new_booking",
          payload: {
            ...(input.customerName ? { caller_name: input.customerName } : {}),
            caller_phone: input.phone,
            start_local: formatLocalHuman(input.startAt, input.timezone),
            ...(input.offeringName ? { service: input.offeringName } : {}),
            ...(input.pendingDeposit ? { note: "awaiting deposit" } : {}),
            // INTAKE-Q-1: the owner's custom questions and what the caller answered.
            ...alertCustomAnswers(input.structuredPayload),
          },
          relatedCallId: ctx.callLogId,
          relatedBookingId: input.bookingId,
        }).then(() => undefined)
      : Promise.resolve(),
  ]);
}
