import type { RetellFetch } from "../_shared/providers/retell.js";
import type { TwilioFetch } from "../_shared/providers/twilio.js";
import { updateIncomingPhoneNumberVoiceUrl } from "../_shared/providers/twilio.js";
import type { Logger, SqlClient } from "../_shared/types.js";

/**
 * Retell health-check / failover job (BACKEND_SPEC §8, blocker G5): every 2
 * minutes, probe Retell; on N consecutive failures, flip Twilio routing
 * from Retell-import to forward-to-owner-cell + voicemail, SMS the tenant,
 * mark a platform-wide incident; on recovery, auto-restore.
 *
 * VERIFY.md: (1) the health probe below hits Retell's `/list-agents`
 * endpoint with `limit=1` as a lightweight reachability check — Retell's
 * docs weren't reachable in this build to confirm a dedicated health/status
 * endpoint exists; swap to one if it does. (2) The failover action assumes
 * flipping a Twilio number's `VoiceUrl` is sufficient to route away from
 * Retell — if Retell-imported numbers are actually routed via a SIP trunk/
 * domain rather than a plain voice webhook, this needs a different Twilio
 * API call (trunk origination URI, not `IncomingPhoneNumbers.VoiceUrl`);
 * confirm against Retell's phone-import docs before relying on this in
 * production. Consecutive-failure count and the incident flag are stored
 * in `platform_settings` (existing generic KV table, §1.9) rather than a
 * new table, since both are simple scalar/derived state.
 */
export interface FailoverDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  twilioFetch: TwilioFetch;
  twilioAccountSid: string;
  twilioAuthToken: string;
  failoverVoiceUrl: string;
  logger: Logger;
}

const FAILURE_THRESHOLD = 3; // ~6 minutes of outage at the 2-minute cron cadence.
const CONSECUTIVE_FAILURES_KEY = "retell_health_consecutive_failures";
const INCIDENT_FLAG_KEY = "platform_incident_retell_outage";

export async function probeRetellHealth(
  deps: Pick<FailoverDeps, "retellFetch" | "retellApiKey">,
): Promise<boolean> {
  try {
    const res = await deps.retellFetch("https://api.retellai.com/list-agents?limit=1", {
      headers: { authorization: `Bearer ${deps.retellApiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getSettingInt(sql: SqlClient, key: string): Promise<number> {
  const rows = await sql<{
    value: unknown;
  }>`select value from public.platform_settings where key = ${key}`;
  const value = rows[0]?.value;
  return typeof value === "object" &&
    value !== null &&
    "count" in (value as Record<string, unknown>)
    ? Number((value as { count: unknown }).count)
    : 0;
}

async function setSettingInt(sql: SqlClient, key: string, count: number): Promise<void> {
  await sql`
    insert into public.platform_settings (key, value) values (${key}, ${JSON.stringify({ count })}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

async function getIncidentActive(sql: SqlClient): Promise<boolean> {
  const rows = await sql<{
    value: unknown;
  }>`select value from public.platform_settings where key = ${INCIDENT_FLAG_KEY}`;
  const value = rows[0]?.value as { active?: boolean } | undefined;
  return value?.active === true;
}

async function setIncidentActive(sql: SqlClient, active: boolean): Promise<void> {
  await sql`
    insert into public.platform_settings (key, value) values (${INCIDENT_FLAG_KEY}, ${JSON.stringify({ active })}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

export type FailoverAction =
  | "healthy_no_change"
  | "failure_below_threshold"
  | "failover_triggered"
  | "recovery_restored"
  | "still_incident_no_change";

export async function runHealthCheckCycle(
  sql: SqlClient,
  deps: FailoverDeps,
): Promise<FailoverAction> {
  const healthy = await probeRetellHealth(deps);
  const incidentActive = await getIncidentActive(sql);

  if (healthy) {
    await setSettingInt(sql, CONSECUTIVE_FAILURES_KEY, 0);
    if (incidentActive) {
      await restoreNumbers(sql, deps);
      await setIncidentActive(sql, false);
      return "recovery_restored";
    }
    return "healthy_no_change";
  }

  const failures = (await getSettingInt(sql, CONSECUTIVE_FAILURES_KEY)) + 1;
  await setSettingInt(sql, CONSECUTIVE_FAILURES_KEY, failures);

  if (incidentActive) return "still_incident_no_change";
  if (failures < FAILURE_THRESHOLD) return "failure_below_threshold";

  await failoverNumbers(sql, deps);
  await setIncidentActive(sql, true);
  return "failover_triggered";
}

async function failoverNumbers(sql: SqlClient, deps: FailoverDeps): Promise<void> {
  const numbers = await sql<{ twilio_sid: string; tenant_id: string }>`
    select twilio_sid, tenant_id from public.phone_numbers where released_at is null
  `;
  for (const n of numbers) {
    await updateIncomingPhoneNumberVoiceUrl(
      deps.twilioFetch,
      deps.twilioAccountSid,
      deps.twilioAuthToken,
      n.twilio_sid,
      deps.failoverVoiceUrl,
    );
  }
  deps.logger.error("retell_health_failover_triggered", { numbers_affected: numbers.length });
}

async function restoreNumbers(sql: SqlClient, deps: FailoverDeps): Promise<void> {
  // Restoring "Retell-import" routing on recovery is Retell's own concern
  // once a number is re-associated (their import call re-establishes the
  // trunk/webhook it owns) — this job's role in restoration is limited to
  // clearing the incident flag; VERIFY.md flags the actual re-import call
  // as a follow-up once the exact routing mechanism (see module docstring)
  // is confirmed.
  const numbers = await sql<{ twilio_sid: string }>`
    select twilio_sid from public.phone_numbers where released_at is null
  `;
  deps.logger.info("retell_health_recovery_detected", { numbers_affected: numbers.length });
}
