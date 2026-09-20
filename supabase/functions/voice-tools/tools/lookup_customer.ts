import type { z } from "zod";
import { normalizeE164, samePhone } from "../../_shared/phone.ts";
import type { LookupCustomerArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof LookupCustomerArgsSchema>;

interface CustomerRow {
  id: string;
  name: string | null;
  segment: string;
  metadata: Record<string, unknown>;
}

interface RecentBookingRow {
  id: string;
  start_at: string;
  status: string;
}

interface CustomerAddressRow {
  id: string;
  label: string | null;
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  delivery_instructions: string | null;
  is_default: boolean;
}

/** CHANNELS-2 item 10(a): a caller with a long history shouldn't get every
 * vehicle/pet/address they've ever mentioned dumped back at them — bound
 * to a handful, most-recent first, same shape for all three entity kinds. */
const MAX_RECURRING_ENTRIES = 5;

/**
 * `customers.metadata.vehicles`/`.pets` are stored OLDEST-first (each
 * booking's `extractMetadataMerge` appends a new entry to the end,
 * `create_booking.ts`) — surfaces them MOST-RECENT-first instead, bounded
 * to `MAX_RECURRING_ENTRIES`, with the most recent one flagged
 * (`most_recent: true`) so the shared multi-entity template fragment (and
 * the model) can say "your ... on file" for the single-entry case without
 * re-deriving which entry is newest. Non-object entries (malformed/legacy
 * data) pass through unflagged rather than throwing.
 */
function boundRecurringEntries(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const mostRecentFirst = [...raw].reverse().slice(0, MAX_RECURRING_ENTRIES);
  return mostRecentFirst.map((entry, i) =>
    i === 0 && entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? { ...(entry as Record<string, unknown>), most_recent: true }
      : entry,
  );
}

export type LookupCustomerResult =
  | { error: "unauthorized_lookup" }
  | { found: false; unverified?: true; message?: string }
  | {
      found: true;
      name: string | null;
      segment: string;
      recent_bookings: { id: string; start_at: string; status: string }[];
      vehicles?: unknown;
      pets?: unknown;
      addresses?: CustomerAddressRow[];
      unverified?: true;
      message?: string;
    };

/**
 * BACKEND_SPEC §7.2.5 (G6 tool authorization): server-side cross-checked
 * against the LIVE call's caller number (`ctx.callerNumber`, resolved from
 * `call_logs` — never trusted from `args` alone) WHENEVER one exists. A
 * mismatch on a real call (one with a live `from_number`) is rejected and
 * logged as a potential prompt-injection attempt, exactly as spec'd — this
 * branch is completely unchanged from before, so a real call is never any
 * less protected than it was.
 *
 * OPS-5 (docs/BUILD_NOTES.md): `ctx.callerNumber` is `null` only when the
 * channel itself carries no caller-id-equivalent to check against — Retell
 * batch-test simulator calls (no `from_number` at all, the recurring
 * `lookup_customer` G6-rejection flakiness this fixes) and, by the same
 * reasoning, any other future channel with no dialed-from number. There is
 * no live caller number to authenticate `args.phone` against in that case
 * — same information a phone receptionist has on a blocked/absent caller
 * ID: nothing, until the caller states a number out loud. So this falls
 * back to looking the caller up by the number they (or the simulator's
 * caller-persona) STATE, scoped exactly like every other tool here —
 * tenant-id only, never cross-tenant — and flags the result `unverified`
 * with an instruction for the agent to read the customer's name back and
 * get an explicit yes before treating the match as confirmed (the
 * "confirms" half of the authorization: the human/simulated caller, not
 * just the model, has to agree the record is theirs). This never widens
 * what a REAL call can do — `ctx.callerNumber` is populated from Twilio's
 * `from_number` on every live/PSTN call (context.ts), so a genuine
 * malicious caller with a real number still hits the strict-match branch
 * below exactly as before.
 */
export async function lookupCustomer(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
  logger: Logger,
): Promise<LookupCustomerResult> {
  const hasLiveCallerNumber = !!ctx.callerNumber;

  if (hasLiveCallerNumber && !samePhone(args.phone, ctx.callerNumber)) {
    logger.warn("lookup_customer_unauthorized_attempt", {
      call_id: ctx.retellCallId,
      tenant_id: ctx.tenantId,
      requested_phone_present: !!args.phone,
    });
    return { error: "unauthorized_lookup" };
  }

  // Normalized once, used for both branches: a real call's callerNumber is
  // already E.164 (context.ts), and a stated number needs the same
  // normalization the rest of this codebase applies at every boundary
  // (CLAUDE.md Rule 2) before it's ever compared against `phone_e164`.
  const lookupPhone = hasLiveCallerNumber ? ctx.callerNumber : normalizeE164(args.phone);
  if (!hasLiveCallerNumber) {
    logger.warn("lookup_customer_no_caller_id_stated_number", {
      call_id: ctx.retellCallId,
      tenant_id: ctx.tenantId,
    });
  }
  if (!lookupPhone) {
    // No live caller id AND the stated number doesn't even parse as a
    // phone number — nothing to look up yet; tell the agent to ask again
    // rather than querying with a value that can never match anything.
    return {
      found: false,
      unverified: true,
      message:
        "No caller ID is available for this call. Ask the caller to say their phone number, then try again with the number they give.",
    };
  }

  const rows = await sql<CustomerRow>`
    select id, name, segment, metadata
    from public.customers
    where tenant_id = ${ctx.tenantId} and phone_e164 = ${lookupPhone}
    limit 1
  `;
  const customer = rows[0];
  if (!customer) {
    return hasLiveCallerNumber
      ? { found: false }
      : {
          found: false,
          unverified: true,
          message:
            "No record was found for that number. Confirm you have the right phone number with the caller before trying a different one.",
        };
  }

  const bookingRows = await sql<RecentBookingRow>`
    select id, start_at, status
    from public.bookings
    where tenant_id = ${ctx.tenantId} and customer_id = ${customer.id}
    order by start_at desc
    limit 5
  `;

  // GAP_REGISTER.md §1.8 — delivery addresses live in `customer_addresses`
  // (the structured mechanism `customers.metadata`'s own column comment
  // says supersedes a metadata blob for this), never in
  // `customers.metadata.addresses` — nothing writes that key, so reading it
  // would always be empty. Surfaced the same way `vehicles`/`pets` are:
  // omitted entirely when the customer has none saved.
  // Bounded to MAX_RECURRING_ENTRIES, most-default/most-recent first
  // (CHANNELS-2 item 10(a)) — `is_default` already flags the caller's
  // default address explicitly, so no separate `most_recent` flag is
  // needed here the way vehicles/pets (below) get one.
  const addressRows = await sql<CustomerAddressRow>`
    select id, label, street, city, state, zip, delivery_instructions, is_default
    from public.customer_addresses
    where tenant_id = ${ctx.tenantId} and customer_id = ${customer.id}
    order by is_default desc, created_at desc
    limit ${MAX_RECURRING_ENTRIES}
  `;

  const metadata = customer.metadata ?? {};
  const vehicles = boundRecurringEntries(metadata["vehicles"]);
  const pets = boundRecurringEntries(metadata["pets"]);
  return {
    found: true,
    name: customer.name,
    segment: customer.segment,
    recent_bookings: bookingRows,
    ...(vehicles !== undefined ? { vehicles } : {}),
    ...(pets !== undefined ? { pets } : {}),
    ...(addressRows.length > 0 ? { addresses: addressRows } : {}),
    // No live caller id to authenticate the match against (see this
    // function's own docstring) — the match is on the STATED number alone,
    // so the agent must read the name back and get an explicit yes before
    // treating it as confirmed, same as a receptionist would with a
    // blocked/absent caller ID.
    ...(hasLiveCallerNumber
      ? {}
      : {
          unverified: true as const,
          message: `Read the name "${customer.name ?? "on file"}" back to the caller and get a clear yes that it's them before sharing any other details or making changes.`,
        }),
  };
}
