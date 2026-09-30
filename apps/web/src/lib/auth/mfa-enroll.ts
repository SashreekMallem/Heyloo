import type { SupabaseClient } from "@supabase/supabase-js";

type MfaClient = Pick<SupabaseClient, "auth">;

export type TotpEnrollment =
  | { status: "ready"; factorId: string; qrCode: string; secret: string }
  /** A verified TOTP factor already exists: the user must challenge, not enrol again. */
  | { status: "already_enrolled" }
  | { status: "error" };

/**
 * Starts a TOTP enrolment that survives revisits (AUTH-03).
 *
 * GoTrue keeps an unverified factor the moment `mfa.enroll` succeeds and
 * rejects a second enrol that reuses the same friendly name
 * (`mfa_factor_name_conflict`), so an admin who abandoned or refreshed
 * `/mfa/enroll` once could never enrol again. This lists the user's factors
 * first (`listFactors().data.all` includes unverified ones; `.totp` is
 * verified-only — supabase-js GoTrueClient `_listFactors`), removes any stale
 * unverified TOTP factor, and enrols under a fresh unique friendly name.
 */
export async function startTotpEnrollment(supabase: MfaClient): Promise<TotpEnrollment> {
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError || !factors) return { status: "error" };

  const totpFactors = factors.all.filter((f) => f.factor_type === "totp");
  if (totpFactors.some((f) => f.status === "verified")) return { status: "already_enrolled" };

  for (const stale of totpFactors) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: stale.id });
    if (error) return { status: "error" };
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  });
  if (error || !data) return { status: "error" };
  return {
    status: "ready",
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}
