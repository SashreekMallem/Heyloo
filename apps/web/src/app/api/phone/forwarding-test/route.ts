import { CARRIERS } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { z } from "zod";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { callEdgeFunction } from "@/lib/edge-functions";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The forwarding test is two calls (LAUNCH-forwarding): `start` places a
 * call from the platform's test line to the tenant's business phone, and
 * `status` is polled until that call is found forwarded to the Heyloo
 * number (or not). `carrier_hint` is advisory and only meaningful on start;
 * an unknown value is dropped rather than failing the test.
 */
const forwardingTestRequestSchema = z.object({
  action: z.enum(["start", "status"]),
  carrier_hint: z.enum(CARRIERS).optional().catch(undefined),
});

/** A start places a real outbound call; bound the wait so the browser never hangs on it. */
const EDGE_TIMEOUT_MS = 20_000;

/**
 * Phone setup "test it" (FRONTEND_SPEC.md §6.7) — proxies to the
 * `forwarding-verify` edge function (verify_jwt: true, so the caller's own
 * access token is forwarded). `tenant_id` is asserted against the caller's
 * own JWT claims, never trusted bare from the body (defense in depth
 * alongside `forwarding-verify` itself already enforcing the identical
 * check server-side — same fix pattern as the checkout seam's tenant_id
 * trust gap, FRONTEND_AUDIT). Only the contract's fields are forwarded, and
 * the edge function's status + body come back unchanged (the wizard maps
 * its `error` / `state` / `reason` codes to copy).
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || !user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

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
  const tenantId = (json as { tenant_id?: unknown } | null)?.tenant_id;
  if (!tenantId || tenantId !== claims.tenant_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = forwardingTestRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { action, carrier_hint: carrierHint } = parsed.data;

  try {
    const { status, body: result } = await callEdgeFunction("forwarding-verify", {
      method: "POST",
      accessToken: session.access_token,
      body: {
        tenant_id: claims.tenant_id,
        action,
        ...(action === "start" && carrierHint ? { carrier_hint: carrierHint } : {}),
      },
      timeoutMs: EDGE_TIMEOUT_MS,
    });
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "forwarding_verify_unreachable" }, { status: 502 });
  }
}
