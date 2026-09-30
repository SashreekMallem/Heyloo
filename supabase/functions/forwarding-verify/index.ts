// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true —
// authenticated tenant owner/admin (BACKEND_SPEC §7.10).
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { normalizeE164 } from "../_shared/phone.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { type ForwardingVerifyDeps, forwardingTestStatus, startForwardingTest } from "./handler.ts";

const logger = createLogger({ fn: "forwarding-verify" });

const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
// The platform's own Retell number test calls come from; override per
// environment. The default is test-riverside-auto's number: the earlier
// default (+16105383920, signup-1-auto's) was deleted in Retell, and every
// test then failed with Retell's bare 404 "Not Found".
const TEST_FROM_NUMBER =
  normalizeE164(Deno.env.get("FORWARDING_TEST_FROM_NUMBER") ?? "") ?? "+12602354330";

interface JwtClaims {
  app_metadata?: { tenant_id?: string; role?: string };
}

function decodeJwtClaims(authHeader: string | null): JwtClaims | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const parts = authHeader.slice("Bearer ".length).split(".");
    return JSON.parse(atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")) as JwtClaims;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  let body: { tenant_id?: string; action?: string; carrier_hint?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.tenant_id || (body.action !== "start" && body.action !== "status")) {
    return jsonResponse({ error: "invalid_request" }, { status: 422 });
  }

  const claims = decodeJwtClaims(req.headers.get("authorization"));
  if (claims?.app_metadata?.tenant_id !== body.tenant_id) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  const deps: ForwardingVerifyDeps = {
    now: () => new Date(),
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    testFromNumber: TEST_FROM_NUMBER,
    logger,
  };
  const sql = getSql();
  const result =
    body.action === "start"
      ? await startForwardingTest(sql, { tenantId: body.tenant_id }, deps)
      : await forwardingTestStatus(
          sql,
          {
            tenantId: body.tenant_id,
            ...(body.carrier_hint ? { carrierHint: body.carrier_hint } : {}),
          },
          deps,
        );

  logger.info("forwarding_verify", {
    tenant_id: body.tenant_id,
    action: body.action,
    status: result.status,
  });
  return jsonResponse(result.body, { status: result.status });
});
