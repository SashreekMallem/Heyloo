// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; the authenticated
// user's id (`sub`) is what this function trusts, never a body-supplied
// user id (same convention as api-checkout/index.ts).
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { JSON_API_CONTENT_TYPES, makeSafeFetch } from "../_shared/safe-fetch.ts";
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

// SSRF-1: adapter hosts are public HTTPS APIs, and ezyVet's base URL is
// tenant-supplied (`adapter_connections.metadata.baseUrl`), so every adapter call
// goes through the SSRF-safe fetch (public targets only, 3 redirects max,
// 5 MB / 15 s caps). See _shared/safe-fetch.ts.
const ADAPTER_FETCH = makeSafeFetch({
  allowedContentTypes: JSON_API_CONTENT_TYPES,
  timeoutMs: 15_000,
});

// QA-1 BE-04: nothing here throws at module load. Each provider's secrets are
// read lazily and stay `undefined` when incomplete, so only the action that
// needs a missing one answers 503 `not_configured` (see handler.ts); before,
// the first unset `requireEnv` killed the isolate for every provider.
function envGroup<K extends string>(names: Record<K, string>): Record<K, string> | undefined {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(names) as K[]) {
    const value = optionalEnv(names[key]);
    if (!value) return undefined;
    out[key] = value;
  }
  return out;
}

function buildDeps(): AdapterConnectDeps {
  return {
    fetchImpl: ADAPTER_FETCH,
    stateSecret: optionalEnv("ADAPTER_CONNECT_STATE_SECRET") || undefined,
    nonce: () => crypto.randomUUID(),
    square: envGroup({
      clientId: "SQUARE_CLIENT_ID",
      clientSecret: "SQUARE_CLIENT_SECRET",
      redirectUri: "SQUARE_OAUTH_REDIRECT_URI",
    }),
    googleCalendar: envGroup({
      clientId: "GOOGLE_CALENDAR_CLIENT_ID",
      clientSecret: "GOOGLE_CALENDAR_CLIENT_SECRET",
      redirectUri: "GOOGLE_CALENDAR_OAUTH_REDIRECT_URI",
    }),
    ezyvet: envGroup({
      clientId: "EZYVET_CLIENT_ID",
      clientSecret: "EZYVET_CLIENT_SECRET",
      partnerId: "EZYVET_PARTNER_ID",
    }),
    tokenEncryptionKey: optionalEnv("ADAPTER_TOKEN_ENCRYPTION_KEY") || undefined,
    logger,
  };
}

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
  const result = await handleAdapterConnect(sql, userId, body, buildDeps());
  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse(result.body, { status: result.status });
});
