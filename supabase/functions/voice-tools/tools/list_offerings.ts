import type { z } from "zod";
import type { ListOfferingsArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof ListOfferingsArgsSchema>;

interface OfferingRow {
  id: string;
  name: string;
  category: string | null;
  duration_minutes: number | null;
  price_cents: number | null;
}

export interface ListOfferingsResult {
  offerings: {
    offering_id: string;
    name: string;
    category: string | null;
    duration_minutes: number | null;
    price_cents: number | null;
  }[];
  none_on_file: boolean;
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

  const rows = await sql<OfferingRow>`
    select id, name, category, duration_minutes, price_cents
    from public.offerings
    where tenant_id = ${ctx.tenantId} and active
      and (${category}::text is null or category = ${category})
    order by category nulls last, name
    limit 50
  `;

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
