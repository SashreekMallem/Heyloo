// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the pg_cron
// "Queue worker poll" job (BACKEND_SPEC §8, every minute).
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { JSON_API_CONTENT_TYPES, makeSafeFetch } from "../_shared/safe-fetch.ts";
import type { AdapterPushDeps } from "./handler.ts";
import { runAdapterPushWorker } from "./handler.ts";

const logger = createLogger({ fn: "worker-adapter-push" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");

// SSRF-1: adapter hosts are public HTTPS APIs, and ezyVet's base URL is
// tenant-supplied (`adapter_connections.metadata.baseUrl`), so every adapter call
// goes through the SSRF-safe fetch (public targets only, 3 redirects max,
// 5 MB / 15 s caps). See _shared/safe-fetch.ts.
const ADAPTER_FETCH = makeSafeFetch({
  allowedContentTypes: JSON_API_CONTENT_TYPES,
  timeoutMs: 15_000,
});

// Per-provider app-level OAuth credentials (never per-tenant — a tenant's
// OWN token lives on their `adapter_connections` row; these are Heyloo's
// registered OAuth app / partner credentials, shared across every tenant
// connected to that provider). Optional so a deploy that hasn't onboarded
// a given adapter yet doesn't fail cold-start over an unset secret — a
// push attempt for that provider simply fails loud instead (never a silent
// skip, matching CLAUDE.md Rule 2's "missing secret = reject").
const DEPS: AdapterPushDeps = {
  fetchImpl: ADAPTER_FETCH,
  tokenEncryptionKey: requireEnv("ADAPTER_TOKEN_ENCRYPTION_KEY"),
  square: {
    clientId: optionalEnv("SQUARE_CLIENT_ID") ?? "",
    clientSecret: optionalEnv("SQUARE_CLIENT_SECRET") ?? "",
  },
  ezyvet: {
    clientId: optionalEnv("EZYVET_CLIENT_ID") ?? "",
    clientSecret: optionalEnv("EZYVET_CLIENT_SECRET") ?? "",
    partnerId: optionalEnv("EZYVET_PARTNER_ID") ?? "",
  },
  googleCalendar: {
    clientId: optionalEnv("GOOGLE_CALENDAR_CLIENT_ID") ?? "",
    clientSecret: optionalEnv("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "",
  },
};

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const result = await runAdapterPushWorker(sql, logger, DEPS);
  return jsonResponse(result);
});
