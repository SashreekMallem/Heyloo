import type { TwilioFetch } from "../_shared/providers/twilio.ts";
import { releasePhoneNumber } from "../_shared/providers/twilio.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type { RetellFetch } from "./retell-delete.ts";
import { deleteRetellPhoneNumber } from "./retell-delete.ts";

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
  twilio_sid: string;
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
      and t.updated_at < ${graceCutoff.toISOString()}::timestamptz
  `;
}

/**
 * OPS (docs/BUILD_NOTES.md QA-BILL): Twilio is not configured on this
 * platform yet (no `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` secret) —
 * both optional here, same `optionalEnv` precedent as Stripe in
 * `job-billing-cycle` (OPS-5/SIGNUP-1), so this job never crashes
 * cold-start. A tenant with NO phone numbers to release (the common case
 * for a throwaway test tenant, and for most cancellations before a number
 * ever gets ported) still reaches the archive step with zero Twilio calls
 * made; a tenant that genuinely has a number pending port-out fails that
 * one release CLOSED (`twilio_not_configured`, logged) rather than
 * crashing the whole run or calling Twilio with an undefined credential.
 */
export interface OffboardingDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  twilioFetch: TwilioFetch;
  twilioAccountSid: string | undefined;
  twilioAuthToken: string | undefined;
  logger: Logger;
}

export type ReleaseOutcome =
  | "released"
  | "retell_delete_failed"
  | "twilio_release_failed"
  | "twilio_not_configured";

export async function releaseOneNumber(
  sql: SqlClient,
  row: PortOutCandidateRow,
  deps: OffboardingDeps,
): Promise<ReleaseOutcome> {
  const retellResult = await deleteRetellPhoneNumber(deps.retellFetch, deps.retellApiKey, row.e164);
  if (!retellResult.ok) {
    deps.logger.warn("job_offboarding_retell_delete_failed", {
      tenant_id: row.tenant_id,
      phone_number_id: row.phone_number_id,
      status: retellResult.status,
    });
    return "retell_delete_failed";
  }

  if (!deps.twilioAccountSid || !deps.twilioAuthToken) {
    deps.logger.warn("job_offboarding_twilio_not_configured", {
      tenant_id: row.tenant_id,
      phone_number_id: row.phone_number_id,
    });
    return "twilio_not_configured";
  }

  const twilioResult = await releasePhoneNumber(
    deps.twilioFetch,
    deps.twilioAccountSid,
    deps.twilioAuthToken,
    row.twilio_sid,
  );
  // 404 means the number was already released by a prior run that failed
  // after the Twilio call succeeded but before this update landed —
  // idempotent-safe to treat as success rather than retrying forever.
  if (!twilioResult.ok && twilioResult.status !== 404) {
    deps.logger.warn("job_offboarding_twilio_release_failed", {
      tenant_id: row.tenant_id,
      phone_number_id: row.phone_number_id,
      status: twilioResult.status,
    });
    return "twilio_release_failed";
  }

  await sql`
    update public.phone_numbers set released_at = now() where id = ${row.phone_number_id}
  `;
  deps.logger.info("job_offboarding_number_released", {
    tenant_id: row.tenant_id,
    phone_number_id: row.phone_number_id,
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
  for (const row of numberCandidates) {
    const outcome = await releaseOneNumber(sql, row, deps);
    if (outcome === "released") numbersReleased += 1;
    else if (outcome === "twilio_not_configured") numbersSkippedNotConfigured += 1;
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
    tenants_archived: archiveCandidates.length,
  };
}
