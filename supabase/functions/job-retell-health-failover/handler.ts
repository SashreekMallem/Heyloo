import {
  raiseNumberOpsAlert,
  resolveNumberOpsAlerts,
} from "../_shared/providers/phone-numbers/ops-alert.ts";
import type { PhoneNumberRegistry } from "../_shared/providers/phone-numbers/registry.ts";
import type { NumberRecord } from "../_shared/providers/phone-numbers/types.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
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
 *
 * NUMBERS-1: failover is per number, through the phone-number port
 * (`_shared/providers/phone-numbers`). Only Twilio-imported numbers can be
 * diverted (we control their Twilio routing). A Retell-NATIVE number (bought
 * through Retell, `twilio_sid` NULL or `retell-native:<e164>`) has no
 * Twilio/SIP resource on our side and Retell exposes no call-routing
 * override that works while Retell is down (docs.retellai.com
 * update-phone-number: agent bindings, `inbound_webhook_url` — a per-call
 * override Retell itself must call — and `fallback_number`, documented as
 * the concurrency-overflow target only), so such numbers are SKIPPED with a
 * logged reason and an open `retell_failover_not_applicable` ops alert per
 * tenant (resolved when the incident ends) instead of erroring on a
 * placeholder Twilio SID. The probe and the incident flag run regardless of
 * whether Twilio is configured.
 */
export interface FailoverDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  /** Per-number provider adapters (NUMBERS-1). Twilio credentials live in
   * the registry's deps and are optional there. */
  numbers: PhoneNumberRegistry;
  /** Where a diverted number's calls go (forward-to-owner-cell + voicemail
   * TwiML). Optional: without it no number can be diverted. */
  failoverVoiceUrl: string | undefined;
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

const NOT_APPLICABLE_ALERT_RULE = "retell_failover_not_applicable";

interface ActiveNumberRow {
  id: string;
  tenant_id: string;
  e164: string;
  twilio_sid: string | null;
}

async function loadActiveNumbers(sql: SqlClient): Promise<ActiveNumberRow[]> {
  return sql<ActiveNumberRow>`
    select id, tenant_id, e164, twilio_sid from public.phone_numbers where released_at is null
  `;
}

function toRecord(n: ActiveNumberRow): NumberRecord {
  return { id: n.id, tenantId: n.tenant_id, e164: n.e164, twilioSid: n.twilio_sid };
}

/** Why this number cannot be diverted right now, or null when it can. */
function failoverBlocker(n: ActiveNumberRow, deps: FailoverDeps): string | null {
  const support = deps.numbers.forNumber(toRecord(n)).failoverSupport();
  if (!support.supported) return support.reason;
  if (!deps.failoverVoiceUrl) return "failover_voice_url_not_configured";
  return null;
}

async function failoverNumbers(sql: SqlClient, deps: FailoverDeps): Promise<void> {
  const numbers = await loadActiveNumbers(sql);
  const snapshot = await getVoiceUrlSnapshot(sql);
  let snapshotChanged = false;
  let diverted = 0;
  let skipped = 0;

  for (const n of numbers) {
    const provider = deps.numbers.forNumber(toRecord(n));
    const blocker = failoverBlocker(n, deps);
    if (blocker !== null || !deps.failoverVoiceUrl) {
      const reason = blocker ?? "failover_voice_url_not_configured";
      skipped += 1;
      deps.logger.error("retell_health_failover_skipped", {
        tenant_id: n.tenant_id,
        phone_number_id: n.id,
        provider: provider.id,
        reason,
      });
      await raiseNumberOpsAlert(sql, {
        rule: NOT_APPLICABLE_ALERT_RULE,
        severity: "critical",
        tenantId: n.tenant_id,
        payload: {
          phone_number_id: n.id,
          e164: n.e164,
          provider: provider.id,
          reason,
          note: "Retell is down and this number could not be diverted; its calls are not being answered.",
        },
      });
      continue;
    }

    // twilio_sid is non-null for a Twilio-provider number (resolveNumberProviderId).
    const key = n.twilio_sid ?? n.id;
    // Idempotent capture: never overwrite an already-captured original with
    // the failover URL itself (defends against this job somehow re-entering
    // failoverNumbers mid-incident, e.g. a future retry path).
    if (!(key in snapshot)) {
      const captured = await provider.captureRouting(toRecord(n));
      if (captured.ok) {
        snapshot[key] = captured.token;
        snapshotChanged = true;
      } else {
        // Never fabricate a "guessed" original VoiceUrl — an honest gap
        // logged for manual restoration if this number can't be
        // snapshotted, rather than silently failing to failover OR
        // inventing a value restoreNumbers would later write back.
        deps.logger.error("retell_health_failover_snapshot_failed", {
          twilio_sid: n.twilio_sid,
          tenant_id: n.tenant_id,
          status: captured.status,
        });
      }
    }

    const result = await provider.divertRouting(toRecord(n), deps.failoverVoiceUrl);
    if (result.ok) diverted += 1;
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
  deps.logger.error("retell_health_failover_triggered", {
    numbers_affected: numbers.length,
    diverted,
    skipped_not_applicable: skipped,
  });
}

/**
 * H2 fix: real restore, not a log line. Flips every still-active DIVERTED
 * number's `VoiceUrl` back to the exact pre-failover value `failoverNumbers`
 * snapshotted (`VOICE_URL_SNAPSHOT_KEY`) — through the same provider call
 * path as the failover direction, just with the original URL. Idempotent: a
 * number successfully restored is removed from the persisted snapshot, so a
 * second `restoreNumbers` invocation (e.g. a retried recovery cycle) finds
 * nothing left to do for it rather than re-issuing a redundant Twilio call
 * or, worse, restoring twice from a stale value. A number this job never
 * managed to snapshot (see `retell_health_failover_snapshot_failed` above)
 * is left alone and logged — never guessed — flagging it for manual
 * re-import, exactly as the module docstring's Retell-import caveat
 * describes. Numbers that were never diverted (Retell-native, or Twilio
 * unconfigured) are untouched. Ends the incident's open
 * `retell_failover_not_applicable` alerts.
 */
async function restoreNumbers(sql: SqlClient, deps: FailoverDeps): Promise<void> {
  const numbers = await loadActiveNumbers(sql);
  const snapshot = await getVoiceUrlSnapshot(sql);
  const remaining: Record<string, string> = {};
  let restored = 0;

  for (const n of numbers) {
    // Never diverted by this job (Retell-native, or Twilio unconfigured).
    if (!deps.numbers.forNumber(toRecord(n)).failoverSupport().supported) continue;
    const key = n.twilio_sid ?? n.id;
    const original = snapshot[key];
    if (!original) {
      deps.logger.warn("retell_health_restore_no_snapshot", {
        twilio_sid: n.twilio_sid,
        tenant_id: n.tenant_id,
      });
      continue;
    }

    const result = await deps.numbers.forNumber(toRecord(n)).restoreRouting(toRecord(n), original);
    if (result.ok) {
      restored += 1;
      deps.logger.info("retell_health_restore_number_updated", {
        twilio_sid: n.twilio_sid,
        tenant_id: n.tenant_id,
        to: original,
      });
    } else {
      // Left in the snapshot for a future recovery cycle to retry — never
      // dropped silently on a failed Twilio call.
      remaining[key] = original;
      deps.logger.error("retell_health_restore_failed", {
        twilio_sid: n.twilio_sid,
        tenant_id: n.tenant_id,
        status: result.status,
      });
    }
  }

  await setVoiceUrlSnapshot(sql, remaining);
  await resolveNumberOpsAlerts(sql, NOT_APPLICABLE_ALERT_RULE);
  deps.logger.info("retell_health_recovery_detected", {
    numbers_affected: numbers.length,
    restored,
  });
}
