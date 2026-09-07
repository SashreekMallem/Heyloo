/**
 * Backend E2E smoke (T9/T11, BUILD_PLAN.md "load test scripts for the hot
 * path" + "full CI green" companion): exercises the REAL `/voice-tools` and
 * `/voice-events` edge functions end to end — real signed Retell webhook
 * requests over HTTP, real Postgres state asserted afterward — against a
 * local Supabase stack. This is deliberately NOT a unit test (every
 * function already has 300+ of those, see `docs/BUILD_NOTES.md`); it is the
 * one place that proves the deployed HTTP boundary (signature verification,
 * the tool-dispatch envelope, the booking exclusion constraint, webhook
 * dedup, background-task cost ingestion) actually works together.
 *
 * Requires a running local stack (Docker):
 *   supabase start
 *   supabase functions serve --env-file .env   # or your local env
 *   node --experimental-strip-types scripts/e2e-backend.ts
 *
 * Not run by default in this build environment (no Docker — same
 * disclosure as `scripts/ci/rls-cross-tenant-probe.ts`'s own header) and not
 * wired into `.github/workflows/ci.yml` — `supabase functions serve` needs
 * the Deno runtime + every function's real secrets (Stripe/Twilio/etc.)
 * live in the same process, which is a heavier CI dependency than the
 * migrations-check/rls-probe jobs' plain `supabase start`. Intended to be
 * run by a human (or a future CI job, once a maintainer decides the
 * `functions serve` + secrets wiring is worth it) before a real go-live, and
 * any time the hot-path handlers change — see `docs/DEPLOY.md`'s go-live
 * checklist, which references this script.
 *
 * Dependency-free by design (plain `fetch` + `node:crypto`), matching
 * `scripts/ci/rls-cross-tenant-probe.ts` and `scripts/setup-stripe.ts` —
 * `scripts/` must not grow a pnpm-workspace dependency. Erasable-TypeScript
 * syntax only (no enums/namespaces/parameter properties).
 *
 * Required env vars (see .env.example):
 *   SUPABASE_URL                 e.g. http://127.0.0.1:54321
 *   SUPABASE_SECRET_KEY           service-role/secret key (fixture setup)
 *   FUNCTIONS_URL                 e.g. http://127.0.0.1:54321/functions/v1
 *                                  (defaults to `${SUPABASE_URL}/functions/v1`)
 *   RETELL_WEBHOOK_SIGNING_SECRET  must match what `voice-tools`/`voice-events`
 *                                  were started with — this script signs
 *                                  every request the same way `_shared/
 *                                  retell-signature.ts` verifies it.
 */

import { createHmac } from "node:crypto";

function env(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key];
    if (v) return v;
  }
  console.error(
    `Missing required env var ${name} (also checked fallbacks: ${fallbacks.join(", ")})`,
  );
  process.exit(1);
}

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const FUNCTIONS_URL = (process.env["FUNCTIONS_URL"] ?? `${SUPABASE_URL}/functions/v1`).replace(
  /\/$/,
  "",
);
const RETELL_SECRET = env("RETELL_WEBHOOK_SIGNING_SECRET");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function restRequest(
  path: string,
  opts: { method?: string; body?: unknown; extraHeaders?: Record<string, string> } = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.extraHeaders ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

async function serviceInsert(
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { status, json } = await restRequest(`/rest/v1/${table}`, {
    method: "POST",
    body: row,
    extraHeaders: { Prefer: "return=representation" },
  });
  if (status >= 300 || !Array.isArray(json) || json.length === 0) {
    throw new Error(`Seed insert into ${table} failed (${status}): ${JSON.stringify(json)}`);
  }
  return json[0] as Record<string, unknown>;
}

/** Signs a body exactly as `_shared/retell-signature.ts` verifies it:
 * `X-Retell-Signature: v=<unix_ms>,d=<hex HMAC-SHA256(secret, rawBody+ts)>`
 * (docs/VERIFY.md VERIFY-1 — re-verify this scheme against a live Retell
 * account before trusting it beyond this local-stack smoke). */
function signRetellBody(rawBody: string): string {
  const ts = Date.now().toString();
  const digest = createHmac("sha256", RETELL_SECRET)
    .update(rawBody + ts)
    .digest("hex");
  return `v=${ts},d=${digest}`;
}

async function callFunction(
  fnPath: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const rawBody = JSON.stringify(body);
  const res = await fetch(`${FUNCTIONS_URL}/${fnPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-retell-signature": signRetellBody(rawBody),
      // `supabase functions serve` still expects a bearer token even when
      // `verify_jwt = false` in config.toml, for the platform's own local
      // gateway — the anon/publishable key satisfies that; the function
      // itself never reads it (auth is the Retell signature above).
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: rawBody,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls a PostgREST read until `predicate` passes or `timeoutMs` elapses —
 * needed because `/voice-events` fast-acks and processes `call_ended` in
 * the background (`EdgeRuntime.waitUntil`), so the DB write lands slightly
 * after the HTTP response (see `voice-events/index.ts`). */
async function pollUntil<T>(
  read: () => Promise<T | undefined>,
  predicate: (value: T) => boolean,
  { timeoutMs = 10_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined && predicate(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

async function main(): Promise<void> {
  console.log(`Backend E2E smoke against ${FUNCTIONS_URL}`);

  // ── 1. Fixture setup (direct service-role inserts — same pattern as
  // scripts/ci/rls-cross-tenant-probe.ts) ──────────────────────────────
  const suffix = Date.now().toString(36);
  const tenant = await serviceInsert("tenants", {
    name: `E2E Backend Co ${suffix}`,
    slug: `e2e-backend-${suffix}`,
    vertical: "generic",
    business_type: "General service business",
    timezone: "America/New_York",
    business_hours: {
      mon: [{ open: "09:00", close: "17:00" }],
      tue: [{ open: "09:00", close: "17:00" }],
      wed: [{ open: "09:00", close: "17:00" }],
      thu: [{ open: "09:00", close: "17:00" }],
      fri: [{ open: "09:00", close: "17:00" }],
      sat: [],
      sun: [],
    },
  });
  const tenantId = tenant["id"] as string;
  console.log(`Created fixture tenant ${tenantId}`);

  const resource = await serviceInsert("resources", {
    tenant_id: tenantId,
    type: "staff",
    name: "E2E Front Desk",
  });
  const resourceId = resource["id"] as string;

  await serviceInsert("offerings", {
    tenant_id: tenantId,
    name: "E2E Consultation",
    category: "consult",
    duration_minutes: 30,
    price_cents: 0,
    resource_type_required: "staff",
  });

  // Generate real availability via the same Postgres function the schema
  // ships (BACKEND_SPEC §3.2) — never hand-crafted slot rows, so this
  // exercises the real slot-subdivision logic too.
  const rpcResult = await restRequest("/rest/v1/rpc/fn_regenerate_availability_slots", {
    method: "POST",
    body: { p_tenant_id: tenantId, p_resource_id: resourceId },
  });
  assert(rpcResult.status < 300, `fn_regenerate_availability_slots failed: ${rpcResult.status}`);

  const retellCallId = `e2e-call-${suffix}`;
  const callLog = await serviceInsert("call_logs", {
    tenant_id: tenantId,
    retell_call_id: retellCallId,
    caller_number: "+15555550123",
    direction: "inbound",
    started_at: new Date().toISOString(),
  });
  console.log(`Created fixture call_logs row ${callLog["id"]} (retell_call_id=${retellCallId})`);

  // ── 2. check_availability — real hot-path read ───────────────────────
  const now = new Date();
  const rangeStart = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const rangeEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();

  const availabilityRes = await callFunction("voice-tools", {
    call_id: retellCallId,
    name: "check_availability",
    args: { date_range: { start: rangeStart, end: rangeEnd }, resource_type: "staff" },
  });
  assert(availabilityRes.status === 200, `check_availability HTTP ${availabilityRes.status}`);
  const availabilityBody = availabilityRes.json as {
    result: {
      slots?: { start: string; end: string; resource_id: string }[];
      none_available?: boolean;
    };
  };
  const slots = availabilityBody.result.slots ?? [];
  assert(slots.length > 0, "check_availability returned no slots for the freshly-generated window");
  const slot = slots[0] as { start: string; end: string; resource_id: string };
  console.log(`check_availability OK — ${slots.length} slot(s), booking the first: ${slot.start}`);

  // ── 3. create_booking — real hot-path write, GIST-exclusion-backed ───
  const bookingArgs = {
    resource_id: slot.resource_id,
    start: slot.start,
    end: slot.end,
    customer: { name: "E2E Test Customer", phone: "+15555550199" },
    consent: { sms: true, call: false },
  };
  const bookingRes = await callFunction("voice-tools", {
    call_id: retellCallId,
    name: "create_booking",
    args: bookingArgs,
  });
  assert(bookingRes.status === 200, `create_booking HTTP ${bookingRes.status}`);
  const bookingBody = bookingRes.json as { result: { confirmed?: boolean; booking_id?: string } };
  assert(
    bookingBody.result.confirmed === true,
    `create_booking did not confirm: ${JSON.stringify(bookingBody)}`,
  );
  const bookingId = bookingBody.result.booking_id;
  assert(!!bookingId, "create_booking response had no booking_id");
  console.log(`create_booking OK — booking ${bookingId}`);

  // Idempotency: an identical retry (same call_id + start) must return the
  // SAME booking, never a duplicate or a constraint-violation error —
  // CLAUDE.md Rule 2 "never check-then-insert".
  const retryRes = await callFunction("voice-tools", {
    call_id: retellCallId,
    name: "create_booking",
    args: bookingArgs,
  });
  assert(retryRes.status === 200, `create_booking retry HTTP ${retryRes.status}`);
  const retryBody = retryRes.json as { result: { confirmed?: boolean; booking_id?: string } };
  assert(
    retryBody.result.booking_id === bookingId,
    `create_booking retry returned a different booking (${retryBody.result.booking_id} vs ${bookingId}) — idempotency key not honored`,
  );
  console.log("create_booking idempotent retry OK — same booking_id returned");

  // ── 4. /voice-events call_ended — signature verify -> dedup -> fast-ack
  // -> background cost ingestion (BACKEND_SPEC §7.3) ───────────────────
  const callEndedBody = {
    event: "call_ended" as const,
    call: {
      call_id: retellCallId,
      agent_id: "e2e-agent",
      from_number: "+15555550199",
      to_number: "+15555550100",
      start_timestamp: now.getTime(),
      end_timestamp: now.getTime() + 45_000,
      disconnection_reason: "user_hangup",
      call_cost: {
        combined_cost: 950, // integer cents, per this codebase's money invariant
        product_costs: [
          { product: "elevenlabs_tts", cost: 300 },
          { product: "llm", cost: 650 },
        ],
      },
      call_analysis: {
        call_summary: "E2E smoke booking call.",
        call_successful: true,
        user_sentiment: "Neutral" as const,
      },
    },
  };
  const eventsRes = await callFunction("voice-events", callEndedBody);
  assert(eventsRes.status === 200, `voice-events HTTP ${eventsRes.status}`);
  console.log("voice-events call_ended accepted (fast-ack) — polling for background processing...");

  const updatedCallLog = await pollUntil(
    async () => {
      const { json } = await restRequest(
        `/rest/v1/call_logs?id=eq.${callLog["id"]}&select=ended_at,cost_cents,disconnection_reason`,
      );
      return Array.isArray(json) && json.length > 0
        ? (json[0] as {
            ended_at: string | null;
            cost_cents: number | null;
            disconnection_reason: string | null;
          })
        : undefined;
    },
    (row) => row.ended_at !== null,
  );
  assert(updatedCallLog.cost_cents === 950, `cost_cents mismatch: ${updatedCallLog.cost_cents}`);
  assert(
    updatedCallLog.disconnection_reason === "user_hangup",
    `disconnection_reason mismatch: ${updatedCallLog.disconnection_reason}`,
  );
  console.log(
    "voice-events background processing OK — call_logs updated with cost + disconnection reason",
  );

  // Webhook dedup: a byte-identical redelivery (Retell's own at-least-once
  // guarantee) must fast-ack without reprocessing (never double-count cost).
  const duplicateRes = await callFunction("voice-events", callEndedBody);
  assert(
    duplicateRes.status === 200,
    `voice-events duplicate delivery HTTP ${duplicateRes.status}`,
  );
  await sleep(500); // give a (wrongly) reprocessed duplicate a moment to land, if it were going to
  const { json: afterDuplicateJson } = await restRequest(
    `/rest/v1/call_logs?id=eq.${callLog["id"]}&select=cost_cents`,
  );
  const afterDuplicate = (afterDuplicateJson as { cost_cents: number }[])[0];
  assert(
    afterDuplicate?.cost_cents === 950,
    `webhook dedup failed — cost_cents changed on redelivery: ${afterDuplicate?.cost_cents}`,
  );
  console.log("voice-events webhook dedup OK — duplicate delivery did not reprocess");

  console.log("\nBackend E2E smoke PASSED — voice-tools + voice-events verified end to end.");
}

main().catch((err) => {
  console.error("Backend E2E smoke FAILED:", err);
  process.exit(1);
});
