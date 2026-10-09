// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt = true
// (config.toml) — Supabase verifies the bearer JWT before this code runs;
// `tenant_id` and `role` come ONLY from the JWT's own `app_metadata`, never a
// body param (CLAUDE.md Rule 2). Owner/admin only (handler.ts
// `authorizeTenantWebhooksCaller`). OUTBOUND-1: outbound webhook
// destinations — see handler.ts.
//
// SSRF: every tenant-supplied URL is checked up front (`assertPublicUrl`)
// and again on every send — "Send test" goes through the shared delivery
// engine, which only ever calls the network through `safeFetch` (public
// https hosts, DNS answers checked, no redirects). The global `fetch` below
// is the transport UNDER that check, never called with an unchecked URL.

import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { zTenantWebhooksRequest } from "../_shared/schemas/outbound-webhooks.ts";
import {
  authorizeTenantWebhooksCaller,
  handleTenantWebhooks,
  type TenantWebhooksClaims,
} from "./handler.ts";

const logger = createLogger({ fn: "api-tenant-webhooks" });
const APP_BASE_URL = optionalEnv("APP_BASE_URL") ?? "https://heyloo.app";

function decodeJwtClaims(authHeader: string | null): TenantWebhooksClaims | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const parts = authHeader.slice("Bearer ".length).split(".");
    return JSON.parse(
      atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? ""),
    ) as TenantWebhooksClaims;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const caller = authorizeTenantWebhooksCaller(decodeJwtClaims(req.headers.get("authorization")));
  if (!caller.ok) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = zTenantWebhooksRequest.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse({ error: "invalid_request", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    const result = await handleTenantWebhooks(getSql(), caller.tenantId, parsed.data, {
      logger,
      delivery: { appBaseUrl: APP_BASE_URL, logger, transport: fetch },
    });
    return jsonResponse(result.body, { status: result.status });
  } catch (err) {
    logger.error("tenant_webhooks_failed", {
      tenant_id: caller.tenantId,
      action: parsed.data.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse({ error: "internal_error" }, { status: 500 });
  }
});
