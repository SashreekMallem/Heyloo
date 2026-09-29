import { NextResponse } from "next/server";
import {
  parseBody,
  requireTenantMember,
  requireTenantWriter,
  updateResult,
} from "@/lib/settings/route-auth";
import { bookingRulesRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

export interface BookingRulesResponse {
  /** `false` until migration 20260929140000_tenant_booking_rules.sql is applied. */
  available: boolean;
  min_notice_minutes: number | null;
  horizon_days: number | null;
}

/** Postgres "undefined column" / PostgREST "column not in schema cache". */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

type BookingRulesRow = {
  booking_min_notice_minutes: number | null;
  booking_horizon_days: number | null;
};

/**
 * `GET|POST /api/tenant/settings/booking-rules` (SETTINGS-1): minimum
 * notice and booking horizon — new `tenants` columns (additive migration
 * `20260929140000_tenant_booking_rules.sql`, applied by the coordinator,
 * not by this task). Until it is applied the read reports
 * `available: false` and the write 503s with `not_available_yet`, so the
 * portal never breaks on a missing column. No call-time reader yet — the
 * Hours tab labels both as "not enforced yet".
 */
export async function GET() {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("tenants")
    .select("booking_min_notice_minutes, booking_horizon_days")
    .eq("id", auth.tenantId)
    .maybeSingle();
  if (isMissingColumn(error)) {
    const body: BookingRulesResponse = {
      available: false,
      min_notice_minutes: null,
      horizon_days: null,
    };
    return NextResponse.json(body);
  }
  if (error) return NextResponse.json({ error: "read_failed" }, { status: 500 });

  const row = data as unknown as BookingRulesRow | null;
  const body: BookingRulesResponse = {
    available: true,
    min_notice_minutes: row?.booking_min_notice_minutes ?? null,
    horizon_days: row?.booking_horizon_days ?? null,
  };
  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, bookingRulesRequestSchema);
  if (!body.ok) return body.response;

  const update: BookingRulesRow = {
    booking_min_notice_minutes: body.data.min_notice_minutes,
    booking_horizon_days: body.data.horizon_days,
  };
  const result = await auth.supabase
    .from("tenants")
    // New columns, not yet on the hand-maintained `TenantRow` type
    // (packages/supabase-client — outside this task's ownership).
    .update(update as never)
    .eq("id", auth.tenantId)
    .select("id");
  if (isMissingColumn(result.error as { code?: string } | null)) {
    return NextResponse.json({ error: "not_available_yet" }, { status: 503 });
  }
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({ ok: true });
}
