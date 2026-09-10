import { bookingCancelSchema, bookingRescheduleSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";
import { parseTstzrange } from "@/lib/tstzrange";

export const runtime = "nodejs";

function formatLocal(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Confirm/reschedule/cancel a booking (FRONTEND_SPEC.md §6.4) — the DB
 * update goes through the caller's own session (RLS `bookings_update`
 * allows tenant-initiated changes); the customer-notification SMS is a
 * best-effort `messages_outbound` insert via service-role (that table has
 * no tenant write policy — sends are otherwise queue-worker-only) so a
 * failed notification never blocks the booking mutation itself, per §6.4's
 * "distinct non-blocking warning, never rolled into a single pass/fail
 * state" rule. Route Handlers have no raw SQL access to call `pgmq.send`
 * directly, so after the insert we call the tenant-scoped
 * `fn_enqueue_message_outbound` RPC
 * (`supabase/migrations/20260910100200_fn_enqueue_message_outbound.sql`) to
 * push `{message_id}` onto `messages_outbound_queue` for
 * `worker-messages-outbound` — without it the row would persist at
 * `status: 'queued'` forever and never actually send. Reschedule takes a
 * `new_slot_id` from `availability_slots`
 * (`bookingRescheduleSchema`) — the same table the voice backend reads, per
 * §6.4 ("the dashboard cannot offer a double-book any more than the phone
 * agent can") — rather than raw timestamps, so the browser never invents a
 * start/end time itself.
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
  const action = (json as { action?: unknown }).action;
  if (action !== "confirm" && action !== "reschedule" && action !== "cancel") {
    return NextResponse.json({ error: "invalid_request" }, { status: 422 });
  }

  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("id, customer_id, resource_id, status")
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();
  if (fetchError || !booking) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: tenant } = await supabase
    .from("tenants")
    .select("timezone")
    .eq("id", claims.tenant_id)
    .maybeSingle();
  const timeZone = tenant?.timezone ?? "America/New_York";

  let templateKey: string;
  let payload: Record<string, unknown> = {};
  let updateResult: { error: { code?: string } | null };

  if (action === "confirm") {
    const { data: current } = await supabase
      .from("bookings")
      .select("start_at")
      .eq("id", id)
      .maybeSingle();
    templateKey = "booking_confirmation";
    payload = { start_local: current ? formatLocal(current.start_at, timeZone) : undefined };
    updateResult = await supabase
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", id)
      .eq("tenant_id", claims.tenant_id);
  } else if (action === "cancel") {
    const parsed = bookingCancelSchema.safeParse({
      booking_id: id,
      reason: (json as { reason?: unknown }).reason,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", issues: parsed.error.issues },
        { status: 422 },
      );
    }
    templateKey = "booking_cancelled";
    updateResult = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: parsed.data.reason ?? null,
      })
      .eq("id", id)
      .eq("tenant_id", claims.tenant_id);
  } else {
    const parsed = bookingRescheduleSchema.safeParse({
      booking_id: id,
      new_slot_id: (json as { new_slot_id?: unknown }).new_slot_id,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const { data: slot } = await supabase
      .from("availability_slots")
      .select("id, slot_range, resource_id, is_available")
      .eq("id", parsed.data.new_slot_id)
      .eq("tenant_id", claims.tenant_id)
      .eq("resource_id", booking.resource_id)
      .maybeSingle();
    if (!slot?.is_available) {
      return NextResponse.json({ error: "slot_not_found" }, { status: 422 });
    }
    const range = parseTstzrange(slot.slot_range);
    if (!range) return NextResponse.json({ error: "slot_not_found" }, { status: 422 });

    templateKey = "booking_confirmation";
    payload = { start_local: formatLocal(range.start, timeZone) };
    updateResult = await supabase
      .from("bookings")
      .update({ start_at: range.start, end_at: range.end, status: "confirmed" })
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
      const { data: outboundMessage, error: smsError } = await service
        .from("messages_outbound")
        .insert({
          tenant_id: claims.tenant_id,
          channel: "sms",
          recipient: customer.phone_e164,
          template_key: templateKey,
          payload,
          related_booking_id: id,
        })
        .select("id")
        .maybeSingle();
      smsQueued = !smsError && !!outboundMessage;
      if (smsQueued && outboundMessage) {
        const { error: enqueueError } = await service.rpc("fn_enqueue_message_outbound", {
          p_message_id: outboundMessage.id,
        });
        if (enqueueError) {
          console.error("fn_enqueue_message_outbound failed", enqueueError);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sms_queued: smsQueued });
}
