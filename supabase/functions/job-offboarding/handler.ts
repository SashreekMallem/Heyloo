import { raiseNumberOpsAlert } from "../_shared/providers/phone-numbers/ops-alert.ts";
import type { PhoneNumberRegistry } from "../_shared/providers/phone-numbers/registry.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Offboarding job (SYSTEM_DESIGN §9 "offboarding = guaranteed number
 * port-out SLA ... retention wind-down (G7)"; API_AND_FLOWS.md Flow 8 steps
 * 2/4; E2E_FLOWS_AUDIT H3 — `webhooks-stripe`'s own comment: "Offboarding
 * wind-down ... is handled by a dedicated job, not inline here" — this is
 * that job). Scope per this cluster's task brief: release phone numbers per
 * the G7 port-out guarantee, and archive (soft-delete) the tenant once that
 * completes. The fuller Flow 8 data-export-bundle-email step (packaging
 * call_logs/bookings/customers/recordings into a downloadable, signed-URL-
 * delivered export) is out of this task's assigned scope — flagged as a
 * follow-up in docs/BUILD_NOTES.md rather than built here (Rule 4).
 *
 * `DECIDE:` (docs/BUILD_NOTES.md CLUSTER-F) — neither BACKEND_SPEC nor
 * SYSTEM_DESIGN state an exact port-out grace-period day count, and
 * `tenants` has no `canceled_at`/`paused_at` timestamp to key off of
 * precisely (a `tenants.canceled_at` column would be the more-correct fix —
 * requested from the DB-owning cluster in docs/audit/FIX_REQUESTS.md).
 * Until that column exists, `tenants.updated_at` is used as a conservative
 * proxy for "time the tenant most recently entered this status": the
 * updated_at trigger fires on ANY row update, so a canceled/paused tenant
 * touched again for an unrelated reason only ever DELAYS release (never
 * releases early) — the safe direction for a guaranteed port-out window. 30
 * days matches the same order of magnitude as `tenants.retention_days`'
 * own BIPA-aware default and common carrier port-out SLAs.
 */
export const PORT_OUT_GRACE_DAYS = 30;

export interface PortOutCandidateRow {
  phone_number_id: string;
  tenant_id: string;
  e164: string;
  /** NULL for a Retell-purchased number, `retell-native:<e164>` for a
   * re-pointed Retell-account number, a real `PN...` SID for a Twilio number
   * imported into Retell — `resolveNumberProviderId` decides. */
  twilio_sid: string | null;
}

export async function findPortOutCandidates(
  sql: SqlClient,
  graceCutoff: Date,
): Promise<PortOutCandidateRow[]> {
  return sql<PortOutCandidateRow>`
    select pn.id as phone_number_id, pn.tenant_id, pn.e164, pn.twilio_sid
    from public.phone_numbers pn
    join public.tenants t on t.id = pn.tenant_id
    where pn.released_at is null
      and t.status in ('canceled', 'paused')
      -- A seasonal pause (G24, motels/restaurants) comes back: releasing a
      -- Retell-purchased number really returns it to the carrier, so the
      -- tenant would lose its number for good. Never wind those down here.
      and not t.seasonal_pause
      and t.updated_at < ${graceCutoff.toISOString()}::timestamptz
  `;
}

/**
 * NUMBERS-1: release goes through the provider-neutral phone-number port
 * (`_shared/providers/phone-numbers`), dispatched per number on its canonical
 * row — Retell-purchased numbers are released in Retell only (they have no
 * Twilio resource; the old Twilio-by-`twilio_sid` call could never work for
 * them and, worse, always failed on the `retell-native:` placeholder),
 * Twilio-imported numbers un-import from Retell then release at Twilio.
 *
 * OPS (docs/BUILD_NOTES.md QA-BILL): Twilio is not configured on this
 * platform yet (no `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` secret) — both
 * optional (registry deps), so this job never crashes cold-start and a
 * Retell-native number never depends on them. A Twilio-imported number
 * whose release needs Twilio fails that one release CLOSED
 * (`twilio_not_configured`, logged) rather than crashing the run.
 *
 * Safety: each release addresses exactly one row's E.164; the row's tenant
 * must be the tenant being wound down (the candidate query joins on it and
 * the `released_at` update repeats the tenant predicate); a number bound to
 * a protected agent (the demo agent) is refused and raised to ops.
 */
export interface OffboardingDeps {
  numbers: PhoneNumberRegistry;
  logger: Logger;
}

export type ReleaseOutcome =
  | "released"
  | "retell_delete_failed"
  | "twilio_release_failed"
  | "twilio_not_configured"
  | "protected_agent_bound";

export async function releaseOneNumber(
  sql: SqlClient,
  row: PortOutCandidateRow,
  deps: OffboardingDeps,
): Promise<ReleaseOutcome> {
  const provider = deps.numbers.forNumber({ twilioSid: row.twilio_sid });
  const result = await provider.release({
    id: row.phone_number_id,
    tenantId: row.tenant_id,
    e164: row.e164,
    twilioSid: row.twilio_sid,
  });

  if (!result.ok) {
    deps.logger.warn("job_offboarding_release_failed", {
      tenant_id: row.tenant_id,
      phone_number_id: row.phone_number_id,
      provider: provider.id,
      reason: result.reason,
      status: result.status,
    });
    // A not-yet-configured Twilio is a known deployment state, not an
    // incident; everything else strands a number past its port-out window.
    if (result.reason !== "twilio_not_configured") {
      await raiseNumberOpsAlert(sql, {
        rule: "number_release_failed",
        severity: result.reason === "protected_agent_bound" ? "critical" : "warning",
        tenantId: row.tenant_id,
        payload: {
          phone_number_id: row.phone_number_id,
          e164: row.e164,
          provider: provider.id,
          reason: result.reason,
          status: result.status,
        },
      });
    }
    return result.reason;
  }

  await sql`
    update public.phone_numbers set released_at = now()
    where id = ${row.phone_number_id} and tenant_id = ${row.tenant_id} and released_at is null
  `;
  deps.logger.info("job_offboarding_number_released", {
    tenant_id: row.tenant_id,
    phone_number_id: row.phone_number_id,
    provider: provider.id,
    already_released: result.alreadyReleased,
  });
  return "released";
}

export interface ArchiveCandidateRow {
  tenant_id: string;
}

export async function findArchiveCandidates(
  sql: SqlClient,
  graceCutoff: Date,
): Promise<ArchiveCandidateRow[]> {
  return sql<ArchiveCandidateRow>`
    select t.id as tenant_id
    from public.tenants t
    where t.status in ('canceled', 'paused')
      and not t.seasonal_pause
      and t.deleted_at is null
      and t.updated_at < ${graceCutoff.toISOString()}::timestamptz
      and not exists (
        select 1 from public.phone_numbers pn
        where pn.tenant_id = t.id and pn.released_at is null
      )
  `;
}

export async function archiveOneTenant(sql: SqlClient, tenantId: string): Promise<void> {
  await sql`
    update public.tenants set deleted_at = now() where id = ${tenantId} and deleted_at is null
  `;
}

export interface OffboardingRunResult {
  numbers_released: number;
  numbers_failed: number;
  numbers_skipped_not_configured: number;
  numbers_refused_protected: number;
  tenants_archived: number;
}

export async function runOffboarding(
  sql: SqlClient,
  now: Date,
  deps: OffboardingDeps,
): Promise<OffboardingRunResult> {
  const graceCutoff = new Date(now.getTime() - PORT_OUT_GRACE_DAYS * 24 * 60 * 60 * 1000);

  const numberCandidates = await findPortOutCandidates(sql, graceCutoff);
  let numbersReleased = 0;
  let numbersFailed = 0;
  let numbersSkippedNotConfigured = 0;
  let numbersRefusedProtected = 0;
  for (const row of numberCandidates) {
    const outcome = await releaseOneNumber(sql, row, deps);
    if (outcome === "released") numbersReleased += 1;
    else if (outcome === "twilio_not_configured") numbersSkippedNotConfigured += 1;
    else if (outcome === "protected_agent_bound") numbersRefusedProtected += 1;
    else numbersFailed += 1;
  }

  const archiveCandidates = await findArchiveCandidates(sql, graceCutoff);
  for (const row of archiveCandidates) {
    await archiveOneTenant(sql, row.tenant_id);
  }

  return {
    numbers_released: numbersReleased,
    numbers_failed: numbersFailed,
    numbers_skipped_not_configured: numbersSkippedNotConfigured,
    numbers_refused_protected: numbersRefusedProtected,
    tenants_archived: archiveCandidates.length,
  };
}
