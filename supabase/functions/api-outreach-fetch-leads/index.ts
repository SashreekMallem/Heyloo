// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true —
// Supabase verifies the bearer JWT itself; this function then explicitly
// checks `platform_admin` in the decoded claims (CLAUDE.md Rule 2 — RLS/JWT
// verification alone is not treated as sufficient), same pattern as
// `admin/index.ts`.

import { isPlatformAdmin } from "../_shared/admin-auth.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { FetchLeadsRequestSchema } from "../_shared/schemas/outreach-fetch-leads.js";
import { handleFetchLeads } from "./handler.js";

const logger = createLogger({ fn: "api-outreach-fetch-leads" });
const APOLLO_API_KEY = requireEnv("APOLLO_API_KEY");
const OUTSCRAPER_API_KEY = requireEnv("OUTSCRAPER_API_KEY");

interface DecodedClaims {
  app_metadata?: { platform_admin?: boolean };
}

function decodeJwtPayload(authHeader: string | null): DecodedClaims | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const parts = authHeader.slice("Bearer ".length).split(".");
    return JSON.parse(atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")) as DecodedClaims;
  } catch {
    return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const claims = decodeJwtPayload(req.headers.get("authorization"));
  if (!isPlatformAdmin(claims)) {
    return jsonResponse({ error: "not_a_platform_admin" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = FetchLeadsRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const sql = getSql();
  const result = await handleFetchLeads(sql, parsed.data, {
    apolloFetch: fetch,
    apolloApiKey: APOLLO_API_KEY,
    outscraperFetch: fetch,
    outscraperApiKey: OUTSCRAPER_API_KEY,
    logger,
    sleep,
  });

  return jsonResponse(result.body, { status: result.status });
});
