import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";
import { requireIntegrationsSession } from "../session";
import { isOAuthProvider, isPasteKeyProvider } from "../shared";

export const runtime = "nodejs";

interface ConnectRequestBody {
  provider?: string;
  api_key?: string;
  base_url?: string;
}

interface AdapterConnectFunctionResponse {
  authorize_url?: string;
  connected?: boolean;
  error?: string;
}

/**
 * `POST /api/tenant/integrations/connect` — proxies to the REAL
 * `api-adapter-connect` edge function (BACKEND_SPEC §7.6), never faking a
 * connection client-side. For an OAuth provider (`square`/
 * `google_calendar`) this calls `action: "initiate"` and hands back
 * `authorize_url` for the dashboard to open in a popup; for a paste-key
 * provider (`shopmonkey`/`ezyvet`) the tenant's pasted credential is
 * validated immediately via `action: "paste_key"` — there is no separate
 * initiate step for these (api-adapter-connect/schema.ts).
 *
 * Every identity-bearing field (tenant_id, role) is resolved server-side
 * from the caller's own session/JWT (`requireIntegrationsSession`), never
 * trusted from the request body — same posture `api/checkout/session/
 * route.ts` documents for its own edge-function proxy.
 */
export async function POST(request: Request) {
  const session = await requireIntegrationsSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!session.canManage) {
    return NextResponse.json({ error: "not_a_tenant_owner_or_admin" }, { status: 403 });
  }

  let body: ConnectRequestBody;
  try {
    body = (await request.json()) as ConnectRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const provider = body.provider;
  if (!provider) return NextResponse.json({ error: "missing_provider" }, { status: 400 });

  let edgeBody: Record<string, unknown>;
  if (isOAuthProvider(provider)) {
    edgeBody = { action: "initiate", provider };
  } else if (isPasteKeyProvider(provider) && provider === "shopmonkey") {
    if (!body.api_key) return NextResponse.json({ error: "missing_api_key" }, { status: 400 });
    edgeBody = { action: "paste_key", provider, api_key: body.api_key };
  } else if (isPasteKeyProvider(provider) && provider === "ezyvet") {
    if (!body.base_url) return NextResponse.json({ error: "missing_base_url" }, { status: 400 });
    edgeBody = { action: "paste_key", provider, base_url: body.base_url };
  } else {
    return NextResponse.json({ error: "unknown_provider" }, { status: 400 });
  }

  const { status, body: result } = await callEdgeFunction<AdapterConnectFunctionResponse>(
    "api-adapter-connect",
    { method: "POST", accessToken: session.accessToken, body: edgeBody },
  );

  if (status !== 200) {
    return NextResponse.json(
      { error: result.error ?? "connect_failed" },
      { status: status || 502 },
    );
  }
  return NextResponse.json(result);
}
