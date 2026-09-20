import type { RetellFetch } from "../_shared/providers/retell.ts";
import type { TwilioFetch } from "../_shared/providers/twilio.ts";
import {
  getIncomingPhoneNumber,
  updateIncomingPhoneNumberVoiceUrl,
} from "../_shared/providers/twilio.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Retell health-check / failover job (BACKEND_SPEC §8, blocker G5): every 2
 * minutes, probe Retell; on N consecutive failures, flip Twilio routing
 * from Retell-import to forward-to-owner-cell + voicemail, SMS the tenant,
 * mark a platform-wide incident; on recovery, auto-restore.
 *
 * RETELL-VERIFY: the health probe below hits `POST /v2/list-agents?limit=1`
 * as a lightweight reachability check — confirmed via retell-typescript-sdk
 * (`Agent.list`, `src/resources/agent.ts`) that "list agents" is a POST to
 * `/v2/list-agents` (with `limit`/`pagination_key`/`sort_order` as QUERY
 * params despite the POST method, and any filter in the JSON body) — NOT a
 * GET to a bare `/list-agents` as this file previously called, which would
 * 405 against the real API and make every health check register as an
 * outage. No dedicated health/status endpoint is documented in the SDK;
 * this remains the lightest real call available. (2) The failover action assumes
 * flipping a Twilio number's `VoiceUrl` is sufficient to route away from
 * Retell — if Retell-imported numbers are actually routed via a SIP trunk/
 * domain rather than a plain voice webhook, this needs a different Twilio
 * API call (trunk origination URI, not `IncomingPhoneNumbers.VoiceUrl`);
 * confirm against Retell's phone-import docs before relying on this in
 * production. Consecutive-failure count, the incident flag, and (H2 fix)
 * the per-number pre-failover `VoiceUrl` snapshot are all stored in
 * `platform_settings` (existing generic KV table, §1.9) rather than a new
 * table/column, since all three are simple scalar/derived state and this
 * task's ownership excludes `supabase/migrations/**` — see
 * `restoreNumbers`, which now really flips `VoiceUrl` back on recovery
 * (previously a no-op log line) using that snapshot, idempotently.
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
// Per-number pre-failover `VoiceUrl` snapshot (H2 fix) — the ONLY way
// `restoreNumbers` can flip a number back to its exact prior routing rather
// than guessing/reconstructing a Retell-import URL. Stored in the existing
// generic `platform_settings` KV table (same pattern as the two keys above)
// rather than a new column/table: this task's ownership doesn't include
// `supabase/migrations/**` (docs/BUILD_NOTES.md JOB-E entry), and a jsonb
// `{twilio_sid: voice_url}` map needs no schema change to live here.
const VOICE_URL_SNAPSHOT_KEY = "retell_health_failover_voice_url_snapshot";

export async function probeRetellHealth(
  deps: Pick<FailoverDeps, "retellFetch" | "retellApiKey">,
): Promise<boolean> {
  try {
    const res = await deps.retellFetch("https://api.retellai.com/v2/list-agents?limit=1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.retellApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
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
    insert into public.platform_settings (key, value) values (${key}, ${{ count }}::jsonb)
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
    insert into public.platform_settings (key, value) values (${INCIDENT_FLAG_KEY}, ${{ active }}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

async function getVoiceUrlSnapshot(sql: SqlClient): Promise<Record<string, string>> {
  const rows = await sql<{ value: unknown }>`
    select value from public.platform_settings where key = ${VOICE_URL_SNAPSHOT_KEY}
  `;
  const value = rows[0]?.value;
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

async function setVoiceUrlSnapshot(
  sql: SqlClient,
  snapshot: Record<string, string>,
): Promise<void> {
  await sql`
    insert into public.platform_settings (key, value) values (${VOICE_URL_SNAPSHOT_KEY}, ${snapshot}::jsonb)
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
  const snapshot = await getVoiceUrlSnapshot(sql);
  let snapshotChanged = false;

  for (const n of numbers) {
    // Idempotent capture: never overwrite an already-captured original with
    // the failover URL itself (defends against this job somehow re-entering
    // failoverNumbers mid-incident, e.g. a future retry path).
    if (!(n.twilio_sid in snapshot)) {
      const current = await getIncomingPhoneNumber(
        deps.twilioFetch,
        deps.twilioAccountSid,
        deps.twilioAuthToken,
        n.twilio_sid,
      );
      const currentVoiceUrl = (current.body as { voice_url?: unknown } | undefined)?.voice_url;
      if (current.ok && typeof currentVoiceUrl === "string" && currentVoiceUrl) {
        snapshot[n.twilio_sid] = currentVoiceUrl;
        snapshotChanged = true;
      } else {
        // Never fabricate a "guessed" original VoiceUrl — an honest gap
        // logged for manual restoration if this number can't be
        // snapshotted, rather than silently failing to failover OR
        // inventing a value restoreNumbers would later write back.
        deps.logger.error("retell_health_failover_snapshot_failed", {
          twilio_sid: n.twilio_sid,
          tenant_id: n.tenant_id,
          status: current.status,
        });
      }
    }

    const result = await updateIncomingPhoneNumberVoiceUrl(
      deps.twilioFetch,
      deps.twilioAccountSid,
      deps.twilioAuthToken,
      n.twilio_sid,
      deps.failoverVoiceUrl,
    );
    deps.logger.error("retell_health_failover_number_updated", {
      twilio_sid: n.twilio_sid,
      tenant_id: n.tenant_id,
      to: deps.failoverVoiceUrl,
      ok: result.ok,
    });
  }

  if (snapshotChanged) {
    await setVoiceUrlSnapshot(sql, snapshot);
  }
  deps.logger.error("retell_health_failover_triggered", { numbers_affected: numbers.length });
}

/**
 * H2 fix: real restore, not a log line. Flips every still-active number's
 * `VoiceUrl` back to the exact pre-failover value `failoverNumbers`
 * snapshotted (`VOICE_URL_SNAPSHOT_KEY`) — the same Twilio client call path
 * as the failover direction, just with the original URL. Idempotent: a
 * number successfully restored is removed from the persisted snapshot, so a
 * second `restoreNumbers` invocation (e.g. a retried recovery cycle) finds
 * nothing left to do for it rather than re-issuing a redundant Twilio call
 * or, worse, restoring twice from a stale value. A number this job never
 * managed to snapshot (see `retell_health_failover_snapshot_failed` above)
 * is left alone and logged — never guessed — flagging it for manual
 * re-import, exactly as the module docstring's Retell-import caveat
 * describes.
 */
async function restoreNumbers(sql: SqlClient, deps: FailoverDeps): Promise<void> {
  const numbers = await sql<{ twilio_sid: string; tenant_id: string }>`
    select twilio_sid, tenant_id from public.phone_numbers where released_at is null
  `;
  const snapshot = await getVoiceUrlSnapshot(sql);
  const remaining: Record<string, string> = {};
  let restored = 0;

  for (const n of numbers) {
    const originalVoiceUrl = snapshot[n.twilio_sid];
    if (!originalVoiceUrl) {
      deps.logger.warn("retell_health_restore_no_snapshot", {
        twilio_sid: n.twilio_sid,
        tenant_id: n.tenant_id,
      });
      continue;
    }

    const result = await updateIncomingPhoneNumberVoiceUrl(
      deps.twilioFetch,
      deps.twilioAccountSid,
      deps.twilioAuthToken,
      n.twilio_sid,
      originalVoiceUrl,
    );
    if (result.ok) {
      restored += 1;
      deps.logger.info("retell_health_restore_number_updated", {
        twilio_sid: n.twilio_sid,
        tenant_id: n.tenant_id,
        to: originalVoiceUrl,
      });
    } else {
      // Left in the snapshot for a future recovery cycle to retry — never
      // dropped silently on a failed Twilio call.
      remaining[n.twilio_sid] = originalVoiceUrl;
      deps.logger.error("retell_health_restore_failed", {
        twilio_sid: n.twilio_sid,
        tenant_id: n.tenant_id,
        status: result.status,
      });
    }
  }

  await setVoiceUrlSnapshot(sql, remaining);
  deps.logger.info("retell_health_recovery_detected", {
    numbers_affected: numbers.length,
    restored,
  });
}
