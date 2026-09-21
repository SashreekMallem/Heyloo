/**
 * Drives the SELFCALL-1 loop: invokes the internal `api-admin-self-call`
 * edge function, which places a REAL PSTN phone call — Retell's own scripted
 * "customer" agent (bound to the platform's own +16105383920 number) calling
 * the platform's own production `test-riverside-auto` number (+12602354330)
 * — polls until the call ends, then prints a summary of both the caller
 * leg (this function's own `get-call` view) and the callee leg (the real
 * `call_logs` row `voice-events` wrote off the real inbound webhook path).
 *
 * Re-runnable: `SUPABASE_URL=... PROVISION_INTERNAL_SECRET=... \
 *   node --experimental-strip-types scripts/e2e/self-call.ts`
 *
 * Required env:
 *   SUPABASE_URL                 e.g. https://qulcubtwqsqgqpfgvorn.supabase.co
 *   PROVISION_INTERNAL_SECRET    same secret every api-admin-* function
 *                                 requires as the x-internal-secret header
 *                                 (never print this — read it from env only)
 * Optional env:
 *   FORCE_RECREATE_CALLER_AGENT  "true" to replace the cached caller agent
 *   MAX_STATUS_POLLS             how many extra `action: "status"` calls to
 *                                 make if the first `run` doesn't settle
 *                                 within its own bounded budget (default 6)
 *   STATUS_POLL_DELAY_MS         delay between those calls (default 8000)
 */

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const PROVISION_INTERNAL_SECRET = requireEnv("PROVISION_INTERNAL_SECRET");
const FORCE_RECREATE = process.env["FORCE_RECREATE_CALLER_AGENT"] === "true";
const MAX_STATUS_POLLS = Number(process.env["MAX_STATUS_POLLS"] ?? "6");
const STATUS_POLL_DELAY_MS = Number(process.env["STATUS_POLL_DELAY_MS"] ?? "8000");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

interface CalleeEvidence {
  found: boolean;
  call_log_id: string | null;
  retell_call_id: string | null;
  is_test_call: boolean | null;
  classification: string | null;
  call_summary: string | null;
  recording_url: string | null;
  transcript_present: boolean;
  booking_id: string | null;
  customer_id: string | null;
}

interface SelfCallBody {
  settled?: boolean;
  caller_call_id?: string;
  caller_agent_id?: string;
  caller_leg?: {
    status: string | null;
    disconnection_reason: string | null;
    duration_ms: number | null;
    transcript: string | null;
    recording_url: string | null;
  };
  callee?: CalleeEvidence | null;
  resume?: { caller_call_id: string };
  error?: string;
  retell_status?: number;
  retell_body?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callSelfCallFn(
  body: Record<string, unknown>,
): Promise<{ status: number; body: SelfCallBody }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/api-admin-self-call`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": PROVISION_INTERNAL_SECRET },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as SelfCallBody;
  return { status: res.status, body: parsed };
}

function printSummary(result: SelfCallBody): void {
  console.log("\n===== SELFCALL-1 summary =====");
  console.log(`settled:            ${result.settled}`);
  console.log(`caller_call_id:     ${result.caller_call_id ?? "-"}`);
  console.log(`caller_agent_id:    ${result.caller_agent_id ?? "-"}`);
  if (result.caller_leg) {
    console.log(`caller status:      ${result.caller_leg.status}`);
    console.log(`disconnection:      ${result.caller_leg.disconnection_reason}`);
    console.log(`duration_ms:        ${result.caller_leg.duration_ms}`);
    console.log(`caller recording:   ${result.caller_leg.recording_url ?? "(not yet available)"}`);
    console.log(
      `caller transcript:  ${result.caller_leg.transcript ? result.caller_leg.transcript.slice(0, 1500) : "(none)"}`,
    );
  }
  if (result.callee) {
    console.log("--- callee (test-riverside-auto, real /voice-inbound path) ---");
    console.log(`found:              ${result.callee.found}`);
    console.log(`call_log_id:        ${result.callee.call_log_id}`);
    console.log(`retell_call_id:     ${result.callee.retell_call_id}`);
    console.log(`is_test_call:       ${result.callee.is_test_call}`);
    console.log(`classification:     ${result.callee.classification}`);
    console.log(`call_summary:       ${result.callee.call_summary}`);
    console.log(`recording_url:      ${result.callee.recording_url ?? "(not yet available)"}`);
    console.log(`transcript present: ${result.callee.transcript_present}`);
    console.log(`booking_id:         ${result.callee.booking_id}`);
    console.log(`customer_id:        ${result.callee.customer_id}`);
  }
  console.log("===============================\n");
}

async function main(): Promise<void> {
  console.log("[self-call] placing a real PSTN call: +16105383920 -> +12602354330 ...");
  const first = await callSelfCallFn({
    action: "run",
    ...(FORCE_RECREATE ? { force_recreate_caller_agent: true } : {}),
  });

  if (first.status >= 400) {
    console.error(
      `[self-call] api-admin-self-call failed: ${first.status}`,
      JSON.stringify(first.body, null, 2),
    );
    if (first.body.error === "retell_create_phone_call_failed") {
      console.error(
        "[self-call] Retell rejected the outbound call attempt — likely account-level " +
          "identity/KYC verification is not complete yet (docs.retellai.com/accounts/kyc). " +
          "See docs/BUILD_NOTES.md SELFCALL-1 and docs/GO_LIVE.md for the exact error captured.",
      );
    }
    process.exit(1);
  }

  let result = first.body;
  console.log(`[self-call] call placed, caller_call_id=${result.caller_call_id}`);

  let polls = 0;
  while (!result.settled && result.resume && polls < MAX_STATUS_POLLS) {
    polls += 1;
    console.log(`[self-call] not settled yet, polling status (${polls}/${MAX_STATUS_POLLS})...`);
    await sleep(STATUS_POLL_DELAY_MS);
    const next = await callSelfCallFn({
      action: "status",
      caller_call_id: result.resume.caller_call_id,
    });
    if (next.status >= 400) {
      console.error(
        "[self-call] status poll failed:",
        next.status,
        JSON.stringify(next.body, null, 2),
      );
      break;
    }
    result = next.body;
  }

  printSummary(result);

  if (!result.settled) {
    console.warn(
      "[self-call] call did not settle within this script's own polling budget — re-run with a " +
        "higher MAX_STATUS_POLLS, or query call_logs directly for the final state.",
    );
  }
}

main().catch((err) => {
  console.error("[self-call] fatal:", err);
  process.exit(1);
});
