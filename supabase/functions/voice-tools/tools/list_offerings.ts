import type { z } from "zod";
import type { ListOfferingsArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import { type CallContext, isPlaceholderCallId } from "../context.ts";

type Args = z.infer<typeof ListOfferingsArgsSchema>;

interface OfferingRow {
  id: string;
  name: string;
  category: string | null;
  duration_minutes: number | null;
  price_cents: number | null;
}

/**
 * F-SPEECH-1: the dental triage prompt says "call list_offerings ONCE", and a live run
 * called it five times (each time speaking a filler, which the caller heard as a stall).
 * After the first answer for a (call, category) the same question is answered with a
 * short "already listed" instead of repeating the catalog. Per isolate and best effort;
 * bounded so a long-lived isolate cannot grow it without limit.
 */
const LISTED_IN_CALL = new Set<string>();
const MAX_TRACKED_LISTINGS = 500;

export const ALREADY_LISTED_MESSAGE =
  "You already have this call's offerings from your earlier list_offerings result. Choose from it; do not call list_offerings again.";

export interface ListOfferingsResult {
  /** Set instead of repeating the list when this call already received it. */
  already_listed?: true;
  message?: string;
  offerings: {
    offering_id: string;
    name: string;
    category: string | null;
    duration_minutes: number | null;
    price_cents: number | null;
  }[];
  none_on_file?: boolean;
}

/**
 * FIX_REQUESTS.md — a real, tool-backed (never model-invented) way to
 * resolve an appointment-type/offering to `offering_id` before
 * `check_availability`/`create_booking`, closing GAP_REGISTER.md §2 Dental
 * item 3 and Vet item 4 (both verticals previously had no way to populate
 * `bookings.offering_id`, so every visit type booked identical-duration
 * slots). Pure read against tenant-scoped `public.offerings`, mirroring
 * `check_availability.ts`'s own shape/latency posture — no side effects,
 * no external calls.
 *
 * `category` is an optional narrowing filter (e.g. "wellness" vs
 * "emergency") — an unset/unmatched category still returns every active
 * offering rather than an empty list, so the model always has something to
 * read the caller instead of silently getting nothing back.
 */
export async function listOfferings(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<ListOfferingsResult> {
  const category = args.category ?? null;

  // Only for a real call id: a batch-test simulator sends the same literal id for every
  // scenario (`isPlaceholderCallId`), and a repeat there is a different conversation.
  const dedupe = !isPlaceholderCallId(ctx.retellCallId);
  const listingKey = `${ctx.tenantId}\u0000${ctx.retellCallId}\u0000${(category ?? "").toLowerCase()}`;
  if (dedupe && LISTED_IN_CALL.has(listingKey)) {
    return { already_listed: true, message: ALREADY_LISTED_MESSAGE, offerings: [] };
  }

  const rows = await sql<OfferingRow>`
    select id, name, category, duration_minutes, price_cents
    from public.offerings
    where tenant_id = ${ctx.tenantId} and active
      and (${category}::text is null or category = ${category})
    order by category nulls last, name
    limit 50
  `;

  if (dedupe) {
    LISTED_IN_CALL.add(listingKey);
    if (LISTED_IN_CALL.size > MAX_TRACKED_LISTINGS) {
      const oldest = LISTED_IN_CALL.values().next().value;
      if (oldest !== undefined) LISTED_IN_CALL.delete(oldest);
    }
  }

  return {
    offerings: rows.map((r) => ({
      offering_id: r.id,
      name: r.name,
      category: r.category,
      duration_minutes: r.duration_minutes,
      price_cents: r.price_cents,
    })),
    none_on_file: rows.length === 0,
  };
}
