import { hmacSha256Hex } from "../_shared/crypto.ts";
import type { Logger } from "../_shared/types.ts";

/**
 * Keep-warm ping (BACKEND_SPEC §8 "Keep-warm ping", SYSTEM_DESIGN §5): every
 * 3 minutes, sends a real, HMAC-signed-but-side-effect-free request to both
 * `/voice-inbound` and `/voice-tools` so the Edge Function instance and its
 * DB connection stay warm ahead of an actual inbound call, rather than
 * paying a cold-start/pool-reconnect penalty on the call that matters.
 *
 * Both requests are engineered to land on each handler's own pre-existing
 * not-found/no-context path — a real DB round trip, zero writes, zero
 * business-logic side effects, never a fabricated success:
 *  - `/voice-inbound`: a NANPA-reserved fictitious `to_number` (never
 *    assignable to a real tenant, per the North American Numbering Plan's
 *    555-01XX reservation) that cannot match any `phone_numbers` row, so
 *    `handleVoiceInbound`'s own not-found branch runs (its documented
 *    "Side effects: none" success path) and returns 404.
 *  - `/voice-tools`: a `call_id` that can never collide with a real Retell
 *    call id (Retell's own shape is `call_xxxxx`) for the known tool
 *    `check_availability` (so `voice-tools/index.ts`'s known-tool
 *    short-circuit doesn't skip dispatch before touching the DB) —
 *    `resolveCallContext` runs its real indexed lookup, finds nothing, and
 *    `dispatchTool` returns the graceful fallback envelope before any
 *    per-tool business logic executes.
 *
 * Both target functions gate on the Retell webhook HMAC signature only
 * (`verify_jwt = false` in supabase/config.toml) — this job holds the same
 * Retell webhook signing key (`requireRetellWebhookKey()`, OPS-4 —
 * `RETELL_WEBHOOK_SIGNING_SECRET` if set, else `RETELL_API_KEY`) those
 * functions already require, and signs
 * its ping bodies exactly as `_shared/retell-signature.ts` verifies them.
 */

const KEEP_WARM_TO_NUMBER = "+18005550100"; // NANPA-reserved fictitious number (555-0100 range)
const KEEP_WARM_FROM_NUMBER = "+18005550101"; // NANPA-reserved fictitious number (555-0100 range)
const KEEP_WARM_CALL_ID = "heyloo-keep-warm-ping"; // never matches Retell's real `call_xxxxx` id shape

export interface KeepWarmDeps {
  fetchImpl: typeof fetch;
  supabaseUrl: string;
  retellWebhookSigningSecret: string;
  logger: Logger;
  now?: () => Date;
}

export interface KeepWarmPingOutcome {
  target: "voice-inbound" | "voice-tools";
  status: number;
  ok: boolean;
}

async function signedRetellPost(
  deps: Pick<KeepWarmDeps, "fetchImpl" | "retellWebhookSigningSecret">,
  url: string,
  rawBody: string,
  now: Date,
): Promise<Response> {
  const timestampMs = now.getTime();
  const digest = await hmacSha256Hex(
    deps.retellWebhookSigningSecret,
    rawBody + String(timestampMs),
  );
  return deps.fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-retell-signature": `v=${timestampMs},d=${digest}`,
    },
    body: rawBody,
  });
}

async function pingVoiceInbound(deps: KeepWarmDeps, now: Date): Promise<KeepWarmPingOutcome> {
  const rawBody = JSON.stringify({
    event: "call_inbound",
    call_inbound: {
      from_number: KEEP_WARM_FROM_NUMBER,
      to_number: KEEP_WARM_TO_NUMBER,
    },
  });
  try {
    const res = await signedRetellPost(
      deps,
      `${deps.supabaseUrl}/functions/v1/voice-inbound`,
      rawBody,
      now,
    );
    // 404 (number_not_found) is the EXPECTED outcome for this sentinel
    // number and is what proves the ping reached the real DB lookup — never
    // treated as a failure.
    const ok = res.status === 404 || res.ok;
    if (!ok) {
      deps.logger.warn("job_keep_warm_unexpected_status", {
        target: "voice-inbound",
        status: res.status,
      });
    }
    return { target: "voice-inbound", status: res.status, ok };
  } catch (err) {
    deps.logger.warn("job_keep_warm_ping_failed", {
      target: "voice-inbound",
      error: String(err),
    });
    return { target: "voice-inbound", status: 0, ok: false };
  }
}

async function pingVoiceTools(deps: KeepWarmDeps, now: Date): Promise<KeepWarmPingOutcome> {
  const rawBody = JSON.stringify({
    call_id: KEEP_WARM_CALL_ID,
    name: "check_availability",
    args: {},
  });
  try {
    const res = await signedRetellPost(
      deps,
      `${deps.supabaseUrl}/functions/v1/voice-tools`,
      rawBody,
      now,
    );
    if (!res.ok) {
      deps.logger.warn("job_keep_warm_unexpected_status", {
        target: "voice-tools",
        status: res.status,
      });
    }
    return { target: "voice-tools", status: res.status, ok: res.ok };
  } catch (err) {
    deps.logger.warn("job_keep_warm_ping_failed", { target: "voice-tools", error: String(err) });
    return { target: "voice-tools", status: 0, ok: false };
  }
}

/**
 * A missed/failed ping is self-healing next cycle (BACKEND_SPEC §8's
 * documented failure behavior for this job) — never thrown, never retried
 * inline; the caller just returns whatever outcomes were observed.
 */
export async function runKeepWarmPing(deps: KeepWarmDeps): Promise<KeepWarmPingOutcome[]> {
  const now = (deps.now ?? (() => new Date()))();
  return [await pingVoiceInbound(deps, now), await pingVoiceTools(deps, now)];
}
