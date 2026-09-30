// Deno entrypoint (excluded from ../tsconfig.json). Invoked every 30 minutes
// by pg_cron via pg_net.http_post (QA-2 BE-03): opens a Realtime WebSocket,
// joins a throw-away channel and leaves, so Realtime creates/maintains the
// realtime.messages daily partitions the dashboards' broadcast triggers need.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { optionalPublishableKey, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { type KeepaliveSocket, runRealtimeKeepalive } from "./handler.ts";

const logger = createLogger({ fn: "job-realtime-keepalive" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const SUPABASE_URL = requireEnv("SUPABASE_URL");

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = optionalPublishableKey();
  if (!apiKey) {
    logger.warn("job_skipped_not_configured", { missing: ["SUPABASE_PUBLISHABLE_KEYS"] });
    return jsonResponse({ skipped: "not_configured" }, { status: 200 });
  }

  const outcome = await runRealtimeKeepalive({
    supabaseUrl: SUPABASE_URL,
    apiKey,
    createSocket: (url) => new WebSocket(url) as unknown as KeepaliveSocket,
    logger,
  });
  // A failed join answers 502 so the failed net._http_response row feeds the
  // `job_failures` alert rule (job-alert-evaluation) instead of hiding.
  return jsonResponse({ outcome }, { status: outcome.ok ? 200 : 502 });
});
