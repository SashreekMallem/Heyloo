import { messageReplySchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const replyBodySchema = z.object({ body: messageReplySchema.shape.body });

/**
 * Reply into a customer SMS thread (MASTER_SPEC.md §3.3/§3.10). Written via
 * service-role, same as `api/tenant/bookings/[id]`'s notification insert —
 * `messages_outbound` has no tenant client-write RLS policy (queue-worker
 * writes only). Uses a `template_key` of `owner_reply` so the outbound
 * worker renders the operator's own verbatim text rather than a fixed
 * transactional template — that case is implemented in
 * `supabase/functions/_shared/templates.ts`. Route Handlers have no raw SQL
 * access to call `pgmq.send` directly, so after the insert we call the
 * tenant-scoped `fn_enqueue_message_outbound` RPC
 * (`supabase/migrations/20260910100200_fn_enqueue_message_outbound.sql`),
 * which pushes `{message_id}` onto `messages_outbound_queue` for
 * `worker-messages-outbound` to pick up — without it the row would persist
 * at `status: 'queued'` forever and never actually send.
 */
export async function POST(request: Request, { params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;
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
  const parsed = replyBodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 422 });

  const service = createSupabaseServiceRoleServerClient();
  const { data: customer } = await service
    .from("customers")
    .select("sms_opt_out")
    .eq("tenant_id", claims.tenant_id)
    .eq("phone_e164", phone)
    .maybeSingle();
  if (customer?.sms_opt_out) {
    return NextResponse.json({ error: "opted_out" }, { status: 422 });
  }

  const { data: message, error } = await service
    .from("messages_outbound")
    .insert({
      tenant_id: claims.tenant_id,
      channel: "sms",
      recipient: phone,
      template_key: "owner_reply",
      payload: { body: parsed.data.body },
    })
    .select("id")
    .maybeSingle();
  if (error || !message) return NextResponse.json({ error: "send_failed" }, { status: 500 });

  const { error: enqueueError } = await service.rpc("fn_enqueue_message_outbound", {
    p_message_id: message.id,
  });
  if (enqueueError) {
    console.error("fn_enqueue_message_outbound failed", enqueueError);
  }

  return NextResponse.json({ ok: true, message_id: message.id });
}
