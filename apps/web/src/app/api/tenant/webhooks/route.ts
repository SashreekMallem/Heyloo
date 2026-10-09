import { zTenantWebhooksRequest } from "@heyloo/canonical-types";
import type { SupabaseServerClient } from "@heyloo/supabase-client";
import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";
import { parseBody, requireTenantMember, requireTenantWriter } from "@/lib/settings/route-auth";

export const runtime = "nodejs";

/** `send_test` waits for one real delivery attempt (5 s per request on the edge side). */
const EDGE_TIMEOUT_MS = 20_000;

/** Responses can carry a signing secret (create / rotate_secret): never cache them anywhere. */
const NO_STORE = { "cache-control": "no-store" };

type WebhookWriteDenial = "owner_or_admin_required" | "read_only_session";

/**
 * The exact rule `api-tenant-webhooks` applies (`authorizeTenantWebhooksCaller`):
 * the JWT's own `role` must be owner/admin — a platform admin's flag alone is
 * not enough there, unlike `requireTenantWriter` — and an impersonated session
 * must have edit mode on. Checked here too so the card can hide controls that
 * would only end in the edge function's 403.
 */
async function webhookWriteDenial(
  supabase: Pick<SupabaseServerClient, "auth">,
): Promise<WebhookWriteDenial | null> {
  const { data, error } = await supabase.auth.getClaims();
  const raw = error || !data ? undefined : data.claims.app_metadata;
  const meta: Record<string, unknown> =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (meta["role"] !== "owner" && meta["role"] !== "admin") return "owner_or_admin_required";
  const impersonatedBy = meta["impersonated_by"];
  if (
    typeof impersonatedBy === "string" &&
    impersonatedBy !== "" &&
    meta["impersonation_edit_enabled"] !== true
  ) {
    return "read_only_session";
  }
  return null;
}

/**
 * `GET /api/tenant/webhooks`: whether this session may change webhooks
 * (`{ can_manage, reason }`), so the Webhooks card only offers writes the
 * edge function will accept. A UX hint; `POST` below re-checks.
 */
export async function GET() {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth.response;
  const reason = await webhookWriteDenial(auth.supabase);
  return NextResponse.json({ can_manage: reason === null, reason }, { headers: NO_STORE });
}

/**
 * `POST /api/tenant/webhooks` (OUTBOUND-1): every Webhooks-card write —
 * `create`, `update`, `delete`, `rotate_secret`, `send_test`, `retry` —
 * proxied to the `api-tenant-webhooks` edge function with the caller's own
 * access token. Owner/admin only here (`requireTenantWriter` plus the edge
 * function's own role rule), and the edge function re-checks the role and
 * takes `tenant_id` from that same JWT; the body never carries a tenant
 * (unknown keys are stripped by the shared `zTenantWebhooksRequest` schema
 * from `@heyloo/canonical-types`). Signing secrets live in Supabase Vault
 * behind that function and only ever pass through this route in the
 * create/rotate answer.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const denied = await webhookWriteDenial(auth.supabase);
  if (denied) return NextResponse.json({ error: denied }, { status: 403, headers: NO_STORE });
  const body = await parseBody(request, zTenantWebhooksRequest);
  if (!body.ok) return body.response;

  const {
    data: { session },
  } = await auth.supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const { status, body: raw } = await callEdgeFunction<unknown>("api-tenant-webhooks", {
      method: "POST",
      accessToken: session.access_token,
      body: body.data,
      timeoutMs: EDGE_TIMEOUT_MS,
    });
    const result: Record<string, unknown> =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    if (status >= 200 && status < 300) {
      return NextResponse.json(result, { status, headers: NO_STORE });
    }
    return NextResponse.json(
      {
        ...result,
        error: typeof result["error"] === "string" ? result["error"] : "webhooks_failed",
      },
      { status: status || 502, headers: NO_STORE },
    );
  } catch {
    return NextResponse.json({ error: "webhooks_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
