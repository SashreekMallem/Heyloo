import { samePhone } from "./phone.ts";

/**
 * MASTER_SPEC §3.7 identity fallback: reschedule/cancel when the live
 * call's caller number differs from the booking's own customer number.
 * The agent may verify with BOTH full name AND exact appointment date/time
 * — on a match, proceed (`identity_verified_by='knowledge'` on the audit
 * trail); otherwise reject. Never reads back other PII during verification
 * (this function only ever compares, never returns customer data).
 */
export interface IdentityVerifyClaim {
  full_name: string;
  appointment_time: string;
}

export type IdentityVerifyResult =
  | { ok: true; verifiedBy: "phone_match" | "knowledge" }
  | {
      ok: false;
      reason: "phone_mismatch_no_verification_offered" | "name_mismatch" | "time_mismatch";
    };

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True if two timestamps represent the same UTC minute — tolerant of
 * millisecond/second formatting differences between what the caller said
 * and the stored ISO timestamp, without loosening past minute-level
 * precision (MASTER_SPEC says "exact appointment date/time"). */
function sameMinute(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return Math.floor(da.getTime() / 60_000) === Math.floor(db.getTime() / 60_000);
}

export function verifyBookingIdentity(params: {
  callerNumber: string | null;
  customerPhone: string | null;
  customerName: string | null;
  bookingStartAt: string;
  verify?: IdentityVerifyClaim;
}): IdentityVerifyResult {
  if (samePhone(params.callerNumber, params.customerPhone)) {
    return { ok: true, verifiedBy: "phone_match" };
  }

  if (!params.verify) {
    return { ok: false, reason: "phone_mismatch_no_verification_offered" };
  }

  if (
    !params.customerName ||
    normalizeName(params.verify.full_name) !== normalizeName(params.customerName)
  ) {
    return { ok: false, reason: "name_mismatch" };
  }

  if (!sameMinute(params.verify.appointment_time, params.bookingStartAt)) {
    return { ok: false, reason: "time_mismatch" };
  }

  return { ok: true, verifiedBy: "knowledge" };
}
