// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: false —
// this is called server-to-server (a tenant's own web-form backend or CRM
// integration), authenticated by a per-tenant `api_tokens` bearer token
// this function verifies itself (CLAUDE.md Rule 2 — never a raw client
// request, never trusts a client-supplied tenant_id).

import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { LeadCallbackRequestSchema } from "../_shared/schemas/lead-callback.ts";
import { handleLeadCallback, resolveTenantFromApiToken } from "./handler.ts";

const logger = createLogger({ fn: "api-lead-callback" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return jsonResponse({ error: "unauthorized" }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = LeadCallbackRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse({ error: "invalid_request", issues: parsed.error.issues }, { status: 422 });
  }

  const sql = getSql();
  const actor = await resolveTenantFromApiToken(sql, token);
  if (!actor) return jsonResponse({ error: "unauthorized" }, { status: 401 });

  const result = await handleLeadCallback(sql, actor.tenant_id, parsed.data, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
