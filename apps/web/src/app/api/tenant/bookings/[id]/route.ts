import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Confirm/reschedule/cancel a booking (FRONTEND_SPEC.md §6.4) — the DB
 * update goes through the caller's own session (RLS `bookings_update`
 * allows tenant-initiated changes); the customer-notification SMS is a
 * best-effort `messages_outbound` insert via service-role (that table has
 * no tenant write policy — sends are otherwise queue-worker-only) so a
 * failed notification never blocks the booking mutation itself, per §6.4's
 * "distinct non-blocking warning, never rolled into a single pass/fail
 * state" rule.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(user);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = json as {
    action: "confirm" | "reschedule" | "cancel";
    new_start?: string;
    new_end?: string;
    reason?: string;
  };

  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("id, customer_id, status")
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();
  if (fetchError || !booking) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let templateKey: string;
  let updateResult: { error: { code?: string } | null };
  if (body.action === "confirm") {
    templateKey = "booking_confirmed";
    updateResult = await supabase
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", id)
      .eq("tenant_id", claims.tenant_id);
  } else if (body.action === "cancel") {
    templateKey = "booking_cancelled";
    updateResult = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: body.reason ?? null,
      })
      .eq("id", id)
      .eq("tenant_id", claims.tenant_id);
  } else {
    if (!body.new_start || !body.new_end) {
      return NextResponse.json({ error: "missing_slot" }, { status: 422 });
    }
    templateKey = "booking_rescheduled";
    updateResult = await supabase
      .from("bookings")
      .update({ start_at: body.new_start, end_at: body.new_end, status: "confirmed" })
      .eq("id", id)
      .eq("tenant_id", claims.tenant_id);
  }

  const { error: updateError } = updateResult;

  if (updateError) {
    if (updateError.code === "23P01") {
      return NextResponse.json({ confirmed: false, reason: "slot_taken" }, { status: 409 });
    }
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  let smsQueued = true;
  if (booking.customer_id) {
    const service = createSupabaseServiceRoleServerClient();
    const { data: customer } = await service
      .from("customers")
      .select("phone_e164, sms_opt_out")
      .eq("id", booking.customer_id)
      .maybeSingle();
    if (customer && !customer.sms_opt_out) {
      const { error: smsError } = await service.from("messages_outbound").insert({
        tenant_id: claims.tenant_id,
        channel: "sms",
        recipient: customer.phone_e164,
        template_key: templateKey,
        related_booking_id: id,
      });
      smsQueued = !smsError;
    }
  }

  return NextResponse.json({ ok: true, sms_queued: smsQueued });
}
