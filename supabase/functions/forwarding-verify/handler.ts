import type { SqlClient } from "../_shared/types.js";

/**
 * `/forwarding-verify` (BACKEND_SPEC §7.10): drives the per-carrier
 * forwarding wizard's automated verification. This build implements the
 * "instructs the tenant to place [the test call]" branch (BACKEND_SPEC's
 * own alternative to placing the call ourselves) — the wizard tells the
 * tenant to call their existing business line, and this function polls
 * `call_logs` for a new inbound call landing on that tenant's Heyloo
 * number within the timeout window, which only happens if the carrier's
 * conditional-forward code was entered correctly. Carrier detection from
 * the raw caller number (a real Twilio Lookup API call) is left as a
 * VERIFY.md follow-up — `detected_carrier` falls back to the wizard's own
 * `carrier_hint` when a live lookup isn't wired.
 */
export interface ForwardingVerifyDeps {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs: number;
  timeoutMs: number;
}

export type ForwardingVerifyResult =
  | { status: 200; body: { verified: true; detected_carrier?: string; next_step: "complete" } }
  | { status: 404; body: { error: string } }
  | { status: 408; body: { verified: false; next_step: "retry" | "try_full_forward" } };

export async function verifyForwarding(
  sql: SqlClient,
  params: { tenantId: string; carrierHint?: string },
  deps: ForwardingVerifyDeps,
): Promise<ForwardingVerifyResult> {
  const numberRows = await sql<{ id: string; e164: string }>`
    select id, e164 from public.phone_numbers where tenant_id = ${params.tenantId} and released_at is null limit 1
  `;
  const number = numberRows[0];
  if (!number) return { status: 404, body: { error: "tenant_number_not_found" } };

  const startedAt = deps.now();
  const deadline = startedAt.getTime() + deps.timeoutMs;

  while (deps.now().getTime() < deadline) {
    const rows = await sql<{ id: string }>`
      select id from public.call_logs
      where phone_number_id = ${number.id} and started_at >= ${startedAt.toISOString()}::timestamptz
      order by started_at asc limit 1
    `;
    if (rows[0]) {
      await sql`
        update public.phone_numbers
        set forwarding_verified_at = now(), forwarding_carrier = ${params.carrierHint ?? "unknown"}
        where id = ${number.id}
      `;
      return {
        status: 200,
        body: {
          verified: true,
          detected_carrier: params.carrierHint ?? "unknown",
          next_step: "complete",
        },
      };
    }
    await deps.sleep(deps.pollIntervalMs);
  }

  return {
    status: 408,
    body: { verified: false, next_step: params.carrierHint ? "try_full_forward" : "retry" },
  };
}
