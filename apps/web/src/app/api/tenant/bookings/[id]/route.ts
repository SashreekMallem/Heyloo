import { bookingCancelSchema, bookingRescheduleSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
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
 * Confirm/reschedule/cancel a booking (FRONTEND_SPEC.md §6.4).
 *
 * ONBOARD-1 (docs/BUILD_NOTES.md): the `bookings` UPDATE itself now goes
 * through the narrowly-scoped service-role client too, not the caller's own
 * RLS-scoped session — live-discovered while proving the "operator screens"
 * cancel action end to end: `fn_notify_waitlist_on_cancellation`
 * (`supabase/migrations/20260907131400_functions_triggers.sql`), an AFTER
 * UPDATE trigger on `bookings`, itself `insert`s into `messages_outbound`
 * when an active waitlist entry overlaps the freed slot — and
 * `messages_outbound` has "no tenant write policy" (this same file's own
 * comment below; sends are otherwise queue-worker-only), so that trigger's
 * insert ran under whatever role actually executed the `UPDATE`. Under the
 * owner's own RLS-scoped session (this route's pre-fix behavior) that
 * insert hit an RLS violation and the WHOLE update rolled back — a real,
 * live 500 (`update_failed`) on cancelling any booking with a matching
 * active waitlist entry, confirmed against `signup-1-auto`'s own seeded
 * waitlist data. `cancel_booking`/`update_booking` on the voice hot path
 * were never affected (they already run on a service-role DB connection),
 * so this was invisible to every prior CALL-* batch-test task. The ownership
 * check above (the caller's OWN session reading this row) still verifies
 * the booking belongs to this tenant before any mutation is attempted;
 * `resource_id`/`customer_id` used below always come from THAT
 * already-verified row or from an `availability_slots` row itself filtered
 * by `claims.tenant_id` — never re-derived from client input — so the
 * `.eq("tenant_id", claims.tenant_id)` filter on every write below remains
 * the real authorization boundary, per CLAUDE.md Rule 2's "still explicitly
 * filter by a verified tenant_id" even off the RLS-scoped session.
 *
 * The customer-notification SMS is a
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

  // AUTH-1 fix (docs/BUILD_NOTES.md, SIGNUP-1 root cause #3): claims live
  // only in the JWT itself, never in the User/session object's
  // app_metadata; claimsFromUser(user) always evaluated to {} for a real
  // tenant/admin/partner here.
  const claims = await claimsFromSupabaseClient(supabase);
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

  // ONBOARD-1: instantiated once, reused for both the status-changing
  // `bookings` update below (see this file's own doc comment) and the
  // pre-existing `messages_outbound` insert further down.
  const service = createSupabaseServiceRoleServerClient();

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
    updateResult = await service
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
    updateResult = await service
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
    updateResult = await service
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
