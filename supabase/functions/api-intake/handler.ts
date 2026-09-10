import { encryptSecret, sha256Hex } from "../_shared/crypto.ts";
import type { IntakeSubmitBody } from "../_shared/schemas/intake.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-intake/{token}` core logic (GAP_REGISTER Cluster G item 4). Public
 * endpoint keyed entirely by the opaque single-use token — no JWT, no
 * tenant/booking/customer id anywhere in the request (CLAUDE.md Rule 2:
 * the token IS the credential, resolved server-side, never trusted from
 * the client; MASTER_SPEC's "no PHI in URL beyond an opaque token").
 *
 * Contract (docs/audit/FIX_REQUESTS.md, Cluster E entry — the public form
 * page is already built against this exactly):
 *   GET  -> `{valid:true, tenant_name, patient_first_name, already_submitted}`
 *           on a resolvable, unexpired token; 404 for anything else
 *           (unknown OR expired — deliberately never distinguished to the
 *           caller here; only POST distinguishes error reasons).
 *   POST -> always HTTP 200 with `{ok:true}` or
 *           `{ok:false, error:"expired"|"already_submitted"|"invalid"}` —
 *           the client reads `data.ok`/`data.error` from a successful
 *           `functions.invoke()`, so a non-2xx here would surface as a
 *           thrown network error instead of the handled error the form
 *           expects.
 */

interface IntakeTokenRow {
  id: string;
  tenant_id: string;
  booking_id: string;
  patient_first_name: string | null;
  used_at: string | null;
  expires_at: string;
}

async function findIntakeToken(sql: SqlClient, token: string): Promise<IntakeTokenRow | null> {
  const tokenHash = await sha256Hex(token);
  const rows = await sql<IntakeTokenRow>`
    select id, tenant_id, booking_id, patient_first_name, used_at, expires_at
    from public.intake_tokens
    where token_hash = ${tokenHash}
    limit 1
  `;
  return rows[0] ?? null;
}

export type IntakeStatusResult =
  | {
      status: 200;
      body: {
        valid: true;
        tenant_name: string;
        patient_first_name: string | null;
        already_submitted: boolean;
      };
    }
  | { status: 404; body: { valid: false } };

export async function getIntakeStatus(sql: SqlClient, token: string): Promise<IntakeStatusResult> {
  const tokenRow = await findIntakeToken(sql, token);
  if (!tokenRow || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return { status: 404, body: { valid: false } };
  }

  const tenantRows = await sql<{ name: string }>`
    select name from public.tenants where id = ${tokenRow.tenant_id}
  `;
  const tenantName = tenantRows[0]?.name ?? "";

  return {
    status: 200,
    body: {
      valid: true,
      tenant_name: tenantName,
      patient_first_name: tokenRow.patient_first_name,
      already_submitted: tokenRow.used_at !== null,
    },
  };
}

export interface IntakeSubmitDeps {
  intakeEncryptionKey: string;
  logger: Logger;
}

export type IntakeSubmitResult =
  | { status: 200; body: { ok: true } }
  | { status: 200; body: { ok: false; error: "invalid" | "expired" | "already_submitted" } };

export async function submitIntake(
  sql: SqlClient,
  token: string,
  input: IntakeSubmitBody,
  deps: IntakeSubmitDeps,
  now: Date = new Date(),
): Promise<IntakeSubmitResult> {
  const tokenRow = await findIntakeToken(sql, token);
  if (!tokenRow) {
    return { status: 200, body: { ok: false, error: "invalid" } };
  }
  if (new Date(tokenRow.expires_at).getTime() <= now.getTime()) {
    return { status: 200, body: { ok: false, error: "expired" } };
  }
  if (tokenRow.used_at) {
    return { status: 200, body: { ok: false, error: "already_submitted" } };
  }

  const dobEncrypted = await encryptSecret(input.date_of_birth, deps.intakeEncryptionKey);
  const insuranceProviderEncrypted = input.insurance_provider
    ? await encryptSecret(input.insurance_provider, deps.intakeEncryptionKey)
    : null;
  const insuranceMemberIdEncrypted = input.insurance_member_id
    ? await encryptSecret(input.insurance_member_id, deps.intakeEncryptionKey)
    : null;
  const insuranceGroupIdEncrypted = input.insurance_group_id
    ? await encryptSecret(input.insurance_group_id, deps.intakeEncryptionKey)
    : null;

  // Single-use enforcement (CLAUDE.md Rule 2 — never check-then-insert):
  // the UPDATE below only flips used_at when it is STILL null, and its
  // result row count is the actual race-proofing — a second concurrent
  // submission with the same token loses this race and gets
  // already_submitted, never both writing an intake_submissions row (which
  // would also violate that table's own intake_submissions_booking_unique
  // constraint).
  const claimed = await sql<{ id: string }>`
    update public.intake_tokens set used_at = ${now.toISOString()}::timestamptz
    where id = ${tokenRow.id} and used_at is null
    returning id
  `;
  if (!claimed[0]) {
    return { status: 200, body: { ok: false, error: "already_submitted" } };
  }

  await sql`
    insert into public.intake_submissions (
      tenant_id, booking_id, intake_token_id, dob_encrypted,
      insurance_provider_encrypted, insurance_member_id_encrypted, insurance_group_id_encrypted
    ) values (
      ${tokenRow.tenant_id}, ${tokenRow.booking_id}, ${tokenRow.id}, ${dobEncrypted},
      ${insuranceProviderEncrypted}, ${insuranceMemberIdEncrypted}, ${insuranceGroupIdEncrypted}
    )
  `;

  deps.logger.info("intake_submitted", {
    tenant_id: tokenRow.tenant_id,
    booking_id: tokenRow.booking_id,
  });

  return { status: 200, body: { ok: true } };
}
