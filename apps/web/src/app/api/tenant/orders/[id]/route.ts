import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const bodySchema = z.object({
  status: z.enum(["received", "confirmed", "preparing", "ready", "completed", "cancelled"]),
});

/**
 * Order status transition from the Orders detail page (E2E_FLOWS_AUDIT.md
 * Flow 5, MASTER_SPEC.md §3.0/§3.10). GAP_REGISTER.md §2 Restaurant item 6
 * ("'order ready' — an api/tenant/orders action + tool-free SMS to the
 * customer via messages_outbound") — a transition INTO `'ready'` sends a
 * best-effort "your order is ready" SMS, mirroring `apps/web/src/app/api/
 * tenant/bookings/[id]/route.ts`'s already-established pattern: the DB
 * update goes through the caller's own session (RLS), the notification is
 * a service-role `messages_outbound` insert (that table has no tenant
 * write policy — sends are otherwise queue-worker-only) enqueued via the
 * tenant-scoped `fn_enqueue_message_outbound` RPC, and a failed
 * notification never blocks or fails the status-update response itself.
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
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 422 });

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, customer_id")
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();
  if (fetchError || !order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await supabase
    .from("orders")
    .update({ status: parsed.data.status })
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  let smsQueued = false;
  if (parsed.data.status === "ready" && order.status !== "ready" && order.customer_id) {
    const service = createSupabaseServiceRoleServerClient();
    const { data: customer } = await service
      .from("customers")
      .select("phone_e164, sms_opt_out")
      .eq("id", order.customer_id)
      .maybeSingle();
    if (customer && !customer.sms_opt_out) {
      const { data: outboundMessage, error: smsError } = await service
        .from("messages_outbound")
        .insert({
          tenant_id: claims.tenant_id,
          channel: "sms",
          recipient: customer.phone_e164,
          template_key: "order_ready",
          payload: {},
          related_order_id: id,
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
