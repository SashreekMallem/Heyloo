import { messageReplySchema, normalizeToE164 } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const replyBodySchema = z.object({ body: messageReplySchema.shape.body });

/** Per-tenant sliding window for owner replies (DB-backed: counts recent `owner_reply` rows). */
const OWNER_REPLY_WINDOW_MS = 10 * 60 * 1000;
const OWNER_REPLY_MAX_PER_WINDOW = 30;

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

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
  const { phone: rawPhone } = await params;
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
  const parsed = replyBodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 422 });

  // CLAUDE.md Rule 2: phones are normalized to E.164 at every boundary — the URL
  // segment is untrusted input, never stored as `recipient` verbatim (QA-1 SEC-10/F-22).
  const phone = normalizeToE164(decodeSegment(rawPhone));
  if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 422 });

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

  // The number must belong to a customer or an existing thread of THIS tenant:
  // a signed-in member cannot use the portal to text arbitrary numbers.
  if (!customer) {
    const [{ data: conversation }, { data: inbound }] = await Promise.all([
      service
        .from("text_conversations")
        .select("id")
        .eq("tenant_id", claims.tenant_id)
        .eq("phone_e164", phone)
        .limit(1)
        .maybeSingle(),
      service
        .from("messages_inbound")
        .select("id")
        .eq("tenant_id", claims.tenant_id)
        .eq("from_e164", phone)
        .limit(1)
        .maybeSingle(),
    ]);
    if (!conversation && !inbound) {
      return NextResponse.json({ error: "unknown_recipient" }, { status: 404 });
    }
  }

  const { count: recentReplies } = await service
    .from("messages_outbound")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", claims.tenant_id)
    .eq("template_key", "owner_reply")
    .gte("created_at", new Date(Date.now() - OWNER_REPLY_WINDOW_MS).toISOString());
  if ((recentReplies ?? 0) >= OWNER_REPLY_MAX_PER_WINDOW) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
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
    // The row would sit at 'queued' forever and the client would record a "You"
    // message that never goes out (QA-1 F-11): fail the row and the request.
    console.error("fn_enqueue_message_outbound failed", enqueueError);
    await service
      .from("messages_outbound")
      .update({ status: "failed", error: "enqueue_failed" })
      .eq("id", message.id)
      .eq("tenant_id", claims.tenant_id);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message_id: message.id });
}
