import { randomOpaqueToken, sha256Hex } from "./crypto.ts";
import type { SqlClient } from "./types.ts";

/**
 * Issues a one-time dental-intake token for a just-created booking and
 * enqueues the SMS that carries its link (GAP_REGISTER Cluster G item 4).
 * Deliberately a plain, dependency-injected helper — NOT a DB trigger —
 * because building the absolute link needs `APP_BASE_URL`, which only
 * exists as an env var in application code (same "build the URL where env
 * access exists" convention `api-payment-link-resend` already follows for
 * `payment_link`; a raw SQL trigger has no env access).
 *
 * Call site (docs/audit/FIX_REQUESTS.md, filed against Cluster CD's
 * `create_booking.ts`): after a booking is successfully inserted for a
 * `vertical: 'dental'` tenant, call this with the new booking's id, tenant
 * id, and the customer's phone — a no-op (never throws) is intentionally
 * NOT provided; a caller that wants "skip for non-dental" logic makes that
 * decision itself before calling, so this function's own contract stays
 * simple: always issue a token for whatever booking id it's given.
 */
export interface IssueDentalIntakeTokenInput {
  tenantId: string;
  bookingId: string;
  customerPhoneE164: string;
  /** `customers.name` for this booking, if known — snapshotted as the
   * first word onto `intake_tokens.patient_first_name` (the
   * `GET /api-intake/{token}` contract's `patient_first_name` field, per
   * docs/audit/FIX_REQUESTS.md). `null`/omitted when the caller has no
   * name on file yet — the form then just omits the personalized greeting. */
  customerName?: string | null;
}

export interface IssueDentalIntakeTokenDeps {
  appBaseUrl: string;
  /** Token lifetime — defaults to 7 days (long enough to cover the gap
   * between booking and a routine dental visit, short enough that a lost/
   * intercepted SMS doesn't stay exploitable indefinitely). */
  tokenTtlMs?: number;
}

const DEFAULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function issueDentalIntakeToken(
  sql: SqlClient,
  input: IssueDentalIntakeTokenInput,
  deps: IssueDentalIntakeTokenDeps,
): Promise<{ intakeTokenId: string }> {
  const token = randomOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + (deps.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS)).toISOString();
  const patientFirstName = input.customerName?.trim().split(/\s+/)[0] || null;

  const rows = await sql<{ id: string }>`
    insert into public.intake_tokens (tenant_id, booking_id, token_hash, patient_first_name, expires_at)
    values (${input.tenantId}, ${input.bookingId}, ${tokenHash}, ${patientFirstName}, ${expiresAt}::timestamptz)
    returning id
  `;
  const intakeTokenId = rows[0]?.id;
  if (!intakeTokenId) {
    throw new Error("intake_token_insert_failed");
  }

  const url = `${deps.appBaseUrl.replace(/\/+$/, "")}/intake/${token}`;
  await sql`
    insert into public.messages_outbound (
      tenant_id, channel, recipient, template_key, payload, related_booking_id
    ) values (
      ${input.tenantId}, 'sms', ${input.customerPhoneE164}, 'dental_intake_link',
      ${JSON.stringify({ url })}::jsonb, ${input.bookingId}
    )
  `;

  return { intakeTokenId };
}
