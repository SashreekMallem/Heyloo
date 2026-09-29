// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the pg_cron
// "worker-tick" job (OPS-3, docs/BUILD_NOTES.md) every minute via
// pg_net.http_post — verify_jwt false, auth is the same shared cron secret
// header every worker-*/job-* function checks (never meant to be
// internet-facing-useful). Replaces three separate per-minute
// worker-messages-outbound/worker-recording-fetch/worker-adapter-push
// pg_cron jobs with ONE per-minute HTTP round trip that fans out to all
// three queue workers in-process — see handler.ts's header comment for the
// root cause this fixes. Each of those three functions' own index.ts stays
// deployed and independently invocable for manual ops/local dev; this is
// an additional caller of their (now-shared) handler.ts entry points, not
// a replacement.
//
// Each leg's required env vars are checked with `missingEnv` (OPS-1's
// pattern) rather than module-scope `requireEnv` — see handler.ts's
// NOT_CONFIGURED comment for why: one leg's missing integration secret
// must never crash cold start for the OTHER two legs' polling. Only
// `CRON_INVOKE_SECRET` (the auth boundary every worker-*/job-* function
// shares) stays a hard `requireEnv`.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import {
  missingEnv,
  optionalEnv,
  optionalServiceRoleKey,
  requireEnv,
} from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import {
  JSON_API_CONTENT_TYPES,
  makeSafeFetch,
  RECORDING_FETCH_OPTIONS,
  SafeFetchError,
  safeFetchBytes,
} from "../_shared/safe-fetch.ts";
import type { AdapterPushDeps } from "../worker-adapter-push/handler.ts";
import { buildOutboundDeps } from "../worker-messages-outbound/deps.ts";
import type { OutboundDeps } from "../worker-messages-outbound/handler.ts";
import type { RecordingFetchDeps, UploadResult } from "../worker-recording-fetch/handler.ts";
import type { NotConfiguredLeg } from "./handler.ts";
import { notConfigured, runWorkerTick } from "./handler.ts";

const logger = createLogger({ fn: "worker-tick" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");

// --- messages_outbound leg (MESSAGING-1: same builder as
// worker-messages-outbound/index.ts — runs when ANY messaging provider is
// configured, e.g. email only) ---
const OUTBOUND = buildOutboundDeps((name) => Deno.env.get(name), fetch, logger);

// --- recording_fetch leg (same vars as worker-recording-fetch/index.ts) ---
const SUPABASE_URL = optionalEnv("SUPABASE_URL");
const SB_SECRET_KEY = optionalServiceRoleKey();
const RECORDING_FETCH_MISSING = [
  ...missingEnv(["RETELL_API_KEY", "SUPABASE_URL"]),
  ...(SB_SECRET_KEY ? [] : ["SB_SECRET_KEY/SUPABASE_SECRET_KEYS"]),
];

async function uploadToStorage(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<UploadResult> {
  // OPS-8 — same fix, same reason, as worker-recording-fetch/index.ts's
  // own `uploadToStorage` (see that file's comment for the full story):
  // Storage rejects a bare new-format `sb_secret_...` key on `authorization:
  // Bearer` with `Invalid Compact JWS`; `apikey` carries the same key
  // alongside it per Supabase's current migrating-to-new-api-keys guidance.
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/recordings/${encodeURI(path.replace(/^recordings\//, ""))}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${SB_SECRET_KEY}`,
        apikey: SB_SECRET_KEY,
        "content-type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  if (res.ok) return { ok: true };
  const bodyText = await res.text().catch(() => "");
  return { ok: false, detail: `${res.status}:${bodyText.slice(0, 200)}` };
}

// SSRF-1: same as worker-recording-fetch/index.ts (provider-supplied URL).
async function fetchRecordingBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await safeFetchBytes(url, RECORDING_FETCH_OPTIONS);
    return res.ok ? res.bytes : null;
  } catch (err) {
    if (!(err instanceof SafeFetchError)) throw err;
    logger.warn("recording_fetch_blocked", { code: err.code });
    return null;
  }
}

// --- adapter_push leg (same vars as worker-adapter-push/index.ts) ---
const ADAPTER_PUSH_MISSING = missingEnv(["ADAPTER_TOKEN_ENCRYPTION_KEY"]);
// SSRF-1: adapter hosts are public HTTPS APIs, and ezyVet's base URL is
// tenant-supplied (`adapter_connections.metadata.baseUrl`), so every adapter call
// goes through the SSRF-safe fetch (public targets only, 3 redirects max,
// 5 MB / 15 s caps). See _shared/safe-fetch.ts.
const ADAPTER_FETCH = makeSafeFetch({
  allowedContentTypes: JSON_API_CONTENT_TYPES,
  timeoutMs: 15_000,
});

// Built even when a required var is missing, so the module stays
// side-effect-free and cheap either way — never USED unless
// `ADAPTER_PUSH_MISSING` is empty (guarded below), so an empty-string
// `tokenEncryptionKey` here never reaches `pushToAdapter`.
const ADAPTER_PUSH_DEPS: AdapterPushDeps = {
  fetchImpl: ADAPTER_FETCH,
  tokenEncryptionKey: optionalEnv("ADAPTER_TOKEN_ENCRYPTION_KEY") ?? "",
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

// Same "built either way, only used when not missing" shape as ADAPTER_PUSH_DEPS above.
const RECORDING_FETCH_DEPS: RecordingFetchDeps = {
  retellFetch: fetch,
  retellApiKey: optionalEnv("RETELL_API_KEY") ?? "",
  uploadToStorage,
  fetchRecordingBytes,
};

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();

  const outboundLeg: OutboundDeps | NotConfiguredLeg = OUTBOUND.configured
    ? OUTBOUND.deps
    : notConfigured(OUTBOUND.missing);

  const result = await runWorkerTick(sql, {
    outbound: outboundLeg,
    recordingFetch:
      RECORDING_FETCH_MISSING.length > 0
        ? notConfigured(RECORDING_FETCH_MISSING)
        : { deps: RECORDING_FETCH_DEPS, logger },
    adapterPush:
      ADAPTER_PUSH_MISSING.length > 0
        ? notConfigured(ADAPTER_PUSH_MISSING)
        : { deps: ADAPTER_PUSH_DEPS, logger },
  });

  for (const [leg, outcome] of [
    ["messages_outbound", result.messages_outbound],
    ["recording_fetch", result.recording_fetch],
    ["adapter_push", result.adapter_push],
  ] as const) {
    if (outcome.status === "skipped") {
      logger.warn("worker_tick_leg_skipped_not_configured", { leg, missing: outcome.missing });
    } else if (outcome.status !== "ok") {
      logger.warn("worker_tick_leg_failed", { leg, status: outcome.status, error: outcome.error });
    }
  }

  return jsonResponse(result);
});
