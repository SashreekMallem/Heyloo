// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; the authenticated
// user's id (`sub`) is what this function trusts, never a body-supplied
// user id (same convention as api-checkout/index.ts).
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import type { AdapterConnectDeps } from "./handler.ts";
import { handleAdapterConnect } from "./handler.ts";

const logger = createLogger({ fn: "api-adapter-connect" });

function decodeSub(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const parts = authHeader.slice("Bearer ".length).split(".");
    const payload = JSON.parse(atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")) as {
      sub?: string;
    };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

const DEPS: AdapterConnectDeps = {
  fetchImpl: fetch,
  stateSecret: requireEnv("ADAPTER_CONNECT_STATE_SECRET"),
  nonce: () => crypto.randomUUID(),
  square: {
    clientId: requireEnv("SQUARE_CLIENT_ID"),
    clientSecret: requireEnv("SQUARE_CLIENT_SECRET"),
    redirectUri: requireEnv("SQUARE_OAUTH_REDIRECT_URI"),
  },
  googleCalendar: {
    clientId: requireEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
    redirectUri: requireEnv("GOOGLE_CALENDAR_OAUTH_REDIRECT_URI"),
  },
  ezyvet: {
    clientId: requireEnv("EZYVET_CLIENT_ID"),
    clientSecret: requireEnv("EZYVET_CLIENT_SECRET"),
    partnerId: requireEnv("EZYVET_PARTNER_ID"),
  },
  logger,
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const userId = decodeSub(req.headers.get("authorization"));
  if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const sql = getSql();
  const result = await handleAdapterConnect(sql, userId, body, DEPS);
  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse(result.body, { status: result.status });
});
