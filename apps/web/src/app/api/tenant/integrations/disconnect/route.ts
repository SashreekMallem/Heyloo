import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";
import { requireIntegrationsSession } from "../session";
import { ADAPTER_PROVIDERS } from "../shared";

export const runtime = "nodejs";

interface DisconnectRequestBody {
  provider?: string;
}

/** `POST /api/tenant/integrations/disconnect` — proxies to
 * `api-adapter-connect`'s `action: "disconnect"` (BACKEND_SPEC §7.6). */
export async function POST(request: Request) {
  const session = await requireIntegrationsSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!session.canManage) {
    return NextResponse.json({ error: "not_a_tenant_owner_or_admin" }, { status: 403 });
  }

  let body: DisconnectRequestBody;
  try {
    body = (await request.json()) as DisconnectRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const provider = body.provider;
  if (!provider || !(ADAPTER_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json({ error: "unknown_provider" }, { status: 400 });
  }

  const { status, body: result } = await callEdgeFunction<{
    disconnected?: boolean;
    error?: string;
  }>("api-adapter-connect", {
    method: "POST",
    accessToken: session.accessToken,
    body: { action: "disconnect", provider },
  });

  if (status !== 200) {
    return NextResponse.json(
      { error: result.error ?? "disconnect_failed" },
      { status: status || 502 },
    );
  }
  return NextResponse.json(result);
}
